// Agent runner:per-trip FIFO、全域併發 1、per-turn spawn + --resume(catclaw 驗證模式)。
// stream-json 解析 → chat blocks 持久化 + WS fan-out;中止 = kill 子程序。
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ChatBlock, ChatMention, ChatMessage } from "../../shared/types";
import { publish, subscribe } from "../bus";
import {
  finalizeMessage,
  getMessage,
  insertBlock,
  insertMessage,
  recoverJobsOnBoot,
  updateBlock,
} from "../chat";
import { db, newId, now } from "../db";
import { HttpError } from "../http";
import { getSetting } from "../settings";
import { setAgentFocus, setAgentStateProvider } from "../ws";
import { getAgentIdentity } from "./identity";
import { mintJobToken, revokeJobToken } from "./tokens";

const GATEWAY_MCP_URL = "http://127.0.0.1:4681/mcp";
const WORKSPACE_ROOT = resolve("./data/agent-workspace");
const ATTACH_ROOT = resolve("./data/attachments");

let claudeAvailable = false;
let claudeVersion = "";

type StreamState = {
  jobId: string;
  tripId: string;
  messageId: string;
  requestedByUserId: string;
  proc: ReturnType<typeof Bun.spawn> | null;
  jobToken: string;
  /** 已定稿並持久化的 blocks(rich block 由 MCP 工具經 appendRichBlock 插入)。 */
  blockCount: number;
  /** 進行中的 text 部分(尚未定稿,晚加入者靠這個補齊)。 */
  liveText: string;
  fullText: string;
  toolIdx: Map<string, number>;
  phase: "thinking" | "tool" | "streaming";
  stopping: boolean;
  stoppedBy: string | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  stderrTail: string[];
};

let active: StreamState | null = null;
let pumping = false;

/** 提案裁決/交通選擇等回饋,下一輪 turn 的 context header 告知 agent。 */
const pendingFeedback = new Map<string, string[]>();

function addFeedback(tripId: string, line: string) {
  const list = pendingFeedback.get(tripId) ?? [];
  list.push(line);
  pendingFeedback.set(tripId, list.slice(-12));
}

function userName(userId: string | null): string {
  if (!userId) return "成員";
  const row = db.query("SELECT name FROM users WHERE id = ?").get(userId) as
    | { name: string }
    | null;
  return row?.name ?? "成員";
}

// ---- 對外 API ----

export function isAgentAvailable() {
  return claudeAvailable;
}

export function enqueueChat(
  tripId: string,
  userId: string,
  text: string,
  attachmentIds: string[],
  mentions: ChatMention[] = [],
): ChatMessage {
  if (!claudeAvailable) {
    throw new HttpError(503, "agent_unavailable", "claude CLI 未安裝或不可用");
  }
  const message = insertMessage({
    tripId,
    role: "user",
    userId,
    content: text,
    status: "queued",
    attachmentIds,
    mentions,
  });
  db.run(
    "INSERT INTO agent_jobs (id, trip_id, chat_message_id, created_at) VALUES (?,?,?,?)",
    [newId(), tripId, message.id, now()],
  );
  publish(tripId, { type: "chat_queued", message, queue: queueInfo() });
  queueMicrotask(pump);
  return message;
}

export function cancelQueued(messageId: string, userId: string): boolean {
  const msg = getMessage(messageId);
  if (!msg || msg.userId !== userId || msg.status !== "queued") return false;
  const res = db.run(
    "UPDATE agent_jobs SET status='stopped', finished_at=? WHERE chat_message_id=? AND status='queued'",
    [now(), messageId],
  );
  if (res.changes === 0) return false;
  finalizeMessage(messageId, "stopped");
  publish(msg.tripId, { type: "chat_cancelled", messageId, queue: queueInfo() });
  return true;
}

export function stopActive(tripId: string, byUserId: string): boolean {
  // 佇列中的訊息一併暫停(轉為可重送/已取消狀態)— 按下停止通常代表「方向要改」,不該讓舊訊息繼續觸發
  const held = db
    .query(
      "SELECT j.chat_message_id AS id FROM agent_jobs j WHERE j.trip_id = ? AND j.status = 'queued'",
    )
    .all(tripId) as Array<{ id: string }>;
  if (held.length > 0) {
    db.run("UPDATE agent_jobs SET status='stopped', finished_at=? WHERE trip_id=? AND status='queued'", [now(), tripId]);
    for (const h of held) {
      finalizeMessage(h.id, "stopped");
      const msg = getMessage(h.id);
      if (msg) publish(tripId, { type: "chat_message", message: msg });
    }
    publish(tripId, { type: "queue", queue: queueInfo() });
  }

  if (!active || active.tripId !== tripId || active.stopping) return held.length > 0;
  active.stopping = true;
  active.stoppedBy = byUserId;
  publish(tripId, { type: "agent_status", state: "stopping", byUserId });
  const proc = active.proc;
  if (proc) {
    proc.kill("SIGTERM");
    const p = proc;
    setTimeout(() => {
      try {
        p.kill("SIGKILL");
      } catch {
        // 已結束
      }
    }, 2000);
  }
  return true;
}

export function resetSession(tripId: string) {
  db.run("UPDATE trips SET agent_session_id = NULL WHERE id = ?", [tripId]);
  const msg = insertMessage({
    tripId,
    role: "system",
    content: "對話脈絡已重置,agent 會重新認識目前的行程。",
  });
  publish(tripId, { type: "chat_message", message: msg });
}

function queueInfo() {
  const rows = db
    .query(
      "SELECT j.chat_message_id AS messageId, j.trip_id AS tripId, m.user_id AS userId FROM agent_jobs j JOIN chat_messages m ON m.id = j.chat_message_id WHERE j.status = 'queued' ORDER BY j.created_at",
    )
    .all() as Array<{ messageId: string; tripId: string; userId: string }>;
  return rows.map((r, i) => ({ ...r, position: i + 1 }));
}

export function getAgentState(tripId: string) {
  return {
    available: claudeAvailable,
    version: claudeVersion,
    model: getSetting("agent_model"),
    identity: getAgentIdentity(tripId),
    queue: queueInfo().filter((q) => q.tripId === tripId),
    running:
      active && active.tripId === tripId
        ? { messageId: active.messageId, phase: active.phase, requestedByUserId: active.requestedByUserId }
        : null,
    activeStream:
      active && active.tripId === tripId
        ? {
            messageId: active.messageId,
            partialText: active.liveText,
            blocks: getMessage(active.messageId)?.blocks ?? [],
          }
        : null,
  };
}

/** MCP 呈現型工具把 rich block 插進正在串流的 assistant 訊息。 */
export function appendRichBlock(tripId: string, block: ChatBlock): { messageId: string; idx: number } | null {
  if (!active || active.tripId !== tripId) return null;
  flushLiveText(active);
  const idx = active.blockCount++;
  insertBlock(active.messageId, idx, block);
  publish(tripId, { type: "chat_block", messageId: active.messageId, idx, block });
  return { messageId: active.messageId, idx };
}

// ---- 內部 ----

function flushLiveText(s: StreamState) {
  if (!s.liveText) return;
  const block: ChatBlock = { kind: "text", text: s.liveText };
  insertBlock(s.messageId, s.blockCount, block);
  publish(s.tripId, { type: "chat_block", messageId: s.messageId, idx: s.blockCount, block });
  s.blockCount++;
  s.fullText += (s.fullText ? "\n\n" : "") + s.liveText;
  s.liveText = "";
}

function toolLabel(name: string, input: Record<string, unknown> | null): string {
  const q = (k: string) => {
    const v = input?.[k];
    return typeof v === "string" ? v.slice(0, 60) : "";
  };
  switch (name) {
    case "mcp__tabimate__get_itinerary":
      return "讀取目前行程";
    case "mcp__tabimate__get_trip_info":
      return "讀取行程資訊";
    case "mcp__tabimate__propose_changes":
      return "建立變更提案";
    case "mcp__tabimate__list_versions":
      return "查看版本歷史";
    case "mcp__tabimate__search_places":
      return input ? `搜尋地點「${q("query")}」` : "搜尋地點";
    case "mcp__tabimate__get_place_details":
      return "查詢地點詳細資訊";
    case "mcp__tabimate__get_directions":
      return "規劃路線與交通";
    case "mcp__tabimate__present_choices":
      return "提供選項讓大家決定";
    case "mcp__tabimate__list_memories":
      return "翻看自己的記憶";
    case "mcp__tabimate__set_identity":
      return "換上新的名字與頭貼";
    case "mcp__tabimate__propose_memory":
      return "送出記憶確認卡";
    case "mcp__tabimate__present_transit_options":
      return "整理交通選項";
    case "mcp__tabimate__report_verification":
      return "回報查證結果";
    case "mcp__tabimate__present_booking_audit":
      return "整理預約清單";
    case "mcp__tabimate__get_google_status":
      return "檢查地圖服務";
    case "WebSearch":
      return input ? `搜尋「${q("query")}」` : "搜尋網路";
    case "WebFetch":
      return input ? `讀取網頁 ${q("url")}` : "讀取網頁";
    case "Read":
      return "讀取附件";
    default:
      return name.replace("mcp__tabimate__", "");
  }
}

function describeMention(tripId: string, m: ChatMention): string {
  if (m.kind === "day") {
    const d = db
      .query(
        "SELECT position, title FROM days WHERE id = ? AND trip_id = ?",
      )
      .get(m.id, tripId) as { position: number; title: string | null } | null;
    if (!d) return `@${m.label} → 這一天已被移除`;
    return `@${m.label} → day id "${m.id}"(Day ${d.position + 1}${d.title ? `,${d.title}` : ""})`;
  }
  const s = db
    .query(
      `SELECT s.name, s.category, s.start_time, s.end_time, d.position AS day_pos
       FROM stops s JOIN days d ON d.id = s.day_id WHERE s.id = ? AND d.trip_id = ?`,
    )
    .get(m.id, tripId) as {
    name: string;
    category: string;
    start_time: string | null;
    end_time: string | null;
    day_pos: number;
  } | null;
  if (!s) return `@${m.label} → 這個對象已被移除`;
  const time = s.start_time ? `,${s.start_time}${s.end_time ? `-${s.end_time}` : ""}` : "";
  if (m.kind === "stop") {
    return `@${m.label} → stop id "${m.id}"(Day ${s.day_pos + 1},${s.category}${time})`;
  }
  return `@${m.label} → 交通段,掛在出發地點 fromStopId "${m.id}"(${s.name},Day ${s.day_pos + 1};set_leg/remove_leg 用這個 id)`;
}

export function buildPrompt(tripId: string, userMsg: ChatMessage): string {
  const trip = db
    .query(
      "SELECT title, destination, start_date, itinerary_rev, agent_last_rev FROM trips WHERE id = ?",
    )
    .get(tripId) as {
    title: string;
    destination: string | null;
    start_date: string | null;
    itinerary_rev: number;
    agent_last_rev: number;
  };
  const lines: string[] = [
    `[context]`,
    `今天日期:${new Date().toLocaleDateString("sv-SE")}`,
    `行程:「${trip.title}」${trip.destination ? `(${trip.destination})` : ""}${trip.start_date ? `,${trip.start_date} 出發` : ""},目前版本 rev ${trip.itinerary_rev}`,
    `這則訊息來自:${userName(userMsg.userId)}`,
  ];

  // 上次對話後的行程變更(從 versions 表比對,重啟不丟):排除塔比自己的提案套用(裁決另行告知)
  if (trip.agent_last_rev > 0 && trip.itinerary_rev > trip.agent_last_rev) {
    const changes = db
      .query(
        `SELECT rev, summary, change_kind, actor_user_id, agent_involved
         FROM versions WHERE trip_id = ? AND rev > ? ORDER BY rev`,
      )
      .all(tripId, trip.agent_last_rev) as Array<{
      rev: number;
      summary: string;
      change_kind: string;
      actor_user_id: string | null;
      agent_involved: number;
    }>;
    const visible = changes.filter(
      (c) => !(c.change_kind === "proposal_apply" && c.agent_involved),
    );
    if (visible.length > 0) {
      lines.push(`上次對話結束後,行程被更動了 ${visible.length} 次:`);
      if (visible.length > 8) lines.push(`- …(較早的 ${visible.length - 8} 筆省略)`);
      for (const c of visible.slice(-8)) {
        lines.push(
          `- rev ${c.rev}:${userName(c.actor_user_id)}${c.change_kind === "rollback" ? "【版本回滾】" : ""} ${c.summary}`,
        );
      }
      if (visible.some((c) => c.change_kind === "rollback")) {
        lines.push(
          `⚠️ 其中包含版本回滾:目前行程可能已不是你記憶中的狀態,你先前提案套用的內容也可能已被還原。提出任何變更前,務必先用 get_itinerary 重新讀取目前行程,不要沿用上次對話的認知。`,
        );
      }
    }
  }
  db.run("UPDATE trips SET agent_last_rev = ? WHERE id = ?", [trip.itinerary_rev, tripId]);

  if (userMsg.mentions.length > 0) {
    lines.push(`使用者用 @ 指名了以下行程對象(直接用這些 id,不要靠名字猜):`);
    for (const m of userMsg.mentions) lines.push(`- ${describeMention(tripId, m)}`);
  }

  const feedback = pendingFeedback.get(tripId) ?? [];
  if (feedback.length > 0) {
    lines.push(`上次回覆之後的進展:`);
    for (const f of feedback) lines.push(`- ${f}`);
    pendingFeedback.set(tripId, []);
  }
  lines.push(`[/context]`, "");
  lines.push(userMsg.content);

  if (userMsg.attachmentIds.length > 0) {
    const rows = db
      .query(
        `SELECT path, filename FROM attachments WHERE id IN (${userMsg.attachmentIds.map(() => "?").join(",")})`,
      )
      .all(...userMsg.attachmentIds) as Array<{ path: string; filename: string }>;
    lines.push("");
    for (const a of rows) {
      lines.push(`使用者附上圖片「${a.filename}」:請用 Read 工具讀取 ${resolve(a.path)}`);
    }
  }
  return lines.join("\n");
}

/** 每輪注入的完整系統提示:persona + 後台附加 + 成員確認過的靈魂/記憶。 */
export function buildAgentSystemPrompt(tripId: string): string {
  let out = SYSTEM_PROMPT;
  const extra = getSetting("agent_system_prompt_extra");
  if (extra) out += `\n\n${extra}`;
  const rows = db
    .query(
      "SELECT kind, content FROM agent_memories WHERE trip_id = ? ORDER BY created_at",
    )
    .all(tripId) as Array<{ kind: string; content: string }>;
  const personas = rows.filter((r) => r.kind === "persona");
  const memories = rows.filter((r) => r.kind === "memory");
  if (personas.length > 0) {
    out += `\n\n# 你的基礎個性(成員與你一起定的,不隨變身改變)\n${personas.map((r) => `- ${r.content}`).join("\n")}`;
  }
  const identity = getAgentIdentity(tripId);
  if (identity.name || identity.rolePersona) {
    out += `\n\n# 你目前的角色(成員要求的變身;變回預設時整段消失)\n你現在是「${identity.name ?? "塔比"}」。${identity.rolePersona ?? ""}\n以這個角色的口吻說話,但行程規劃的專業、查證標準與平台操作規則完全不變。`;
  }
  if (memories.length > 0) {
    out += `\n\n# 你的記憶(成員確認過的事,對話重置也記得)\n${memories.map((r) => `- ${r.content}`).join("\n")}`;
  }
  return out;
}

const SYSTEM_PROMPT = `你是「塔比」(Tabi),tabimate 的 AI 旅遊嚮導 — 熟門熟路、親切又帶點幽默感,像朋友裡最會安排行程的那一位,陪一群同行成員規劃這趟旅程。你的回覆顯示在所有成員共用的聊天室,每則訊息開頭的 [context] 會標明是誰在跟你說話。

# 語氣與個性
- 親切自然、偶爾一點輕鬆幽默;不裝可愛、不濫用表情符號(頂多偶爾一個)。
- 自稱「我」就好,不必一直提自己的名字。
- 玩笑點到為止,資訊必須紮實 — 嚮導的可愛在於可靠。

# 推薦的分寸
- 只在「相關時機」順帶推薦:排某一區的行程時提順路的一兩個選擇、發現明顯空檔時建議填法、成員主動問的時候。
- 一次最多推 1-2 個,講清楚為什麼適合(順路/時段/成員偏好),不要清單式轟炸。
- 成員沒接受的建議不要重提;不要每則回覆都硬塞推薦,沒有合適的就不推。

# 專業導遊準則
- 動線優先:同區域的點集中排、順路不走回頭路;考量開閉館時間、最後入場、公休日、尖峰人潮與移動時間。
- 住宿:每段住宿只有一張「主卡」= 入住日排序最前的 lodging(startTime=check-in、endTime=退房日早上的退房時間、nights=住幾晚都設定在它身上);中途回飯店休息就在主卡之後加同飯店的輕量卡(當天時段)。續住日每天頭尾會自動顯示住宿錨點,「那天幾點離開/回到住宿」與「住宿↔頭尾行程的交通」用 update_day 的 lodgingDepartTime/lodgingReturnTime/lodgingMorningLeg/lodgingEveningLeg 設定(詳見工具說明)。安排一天行程時把離開/回到住宿的動線一併排好。
- 節奏合理:安排正常的午晚餐時段,熱門店標記要訂位;行程別塞太滿,景點之間留緩衝。
- 在地視角:主動給在地人等級的建議(交通 IC 卡、整理券、預約文化、雨天替代方案、季節限定活動)。
- 避免撲空:營業時間、公休日、班次、預約規則屬於事實,先查證再排;查不到可靠資訊就明說。
- 預算意識:適時附上門票、交通、餐費的概估。

# 平台操作(你在 tabimate 裡工作)
成員的畫面是「天數分頁 + 每日時間軸 + 地圖 + 這個聊天室」,你的每個動作他們都即時看得到。
- 變身:成員明確要你「變成某個角色」(動漫人物/歷史人物/某種個性的角色)時,用 mcp__tabimate__set_identity **一次設定名稱+頭貼+rolePersona(角色的說話口吻與人設,兩三句)**:頭貼先 WebSearch 找該角色的圖(優先 Wikipedia/Wikimedia 或官方 wiki 的**直接圖檔連結**(.jpg/.png);頁面連結就 WebFetch 找 og:image 或圖檔 URL),抓不到就換來源重試;純個性描述的角色就發揮創意找貼切的公開圖。角色是「變身的一部分」,變回預設(set_identity reset)時名稱/頭貼/角色口吻整套卸下;**基礎個性與記憶不受變身影響**,恆久的語氣調整才用 propose_memory(persona)。**沒被要求不要主動變身**。
- 記憶:成員明確要你「記住某件事」「調整個性」「修改/忘掉之前記的事」時,用 mcp__tabimate__propose_memory 送出記憶確認卡(action=add/update/remove;update/remove 先 list_memories 拿 memoryId),成員按下確認才會真正生效(之後每輪對話你都會帶著它,重置對話也不忘)。**平常不要主動提出記憶請求**;內容精煉成一句話。
- 讀行程:任何操作前先 mcp__tabimate__get_itinerary(拿最新狀態與正確 id);get_trip_info 拿成員名單與日期。
- 改行程:唯一途徑是 mcp__tabimate__propose_changes(提案制)。提案送出後立即返回,任一成員會在畫面上確認或拒絕,結果在你下一輪的 [context] 告知。絕不宣稱「已經加入/改好了」,要說「提案已送出,請在畫面上確認」。
- 行程會在你不在場時被改動:成員可直接編輯,也可能把整個行程回滾到較早版本。[context] 開頭會列出上次對話後的所有更動;看到【版本回滾】就把記憶中的行程狀態視為作廢,先 get_itinerary 再行動。
- 交通購票:新幹線、機場快線(Skyliner/N'EX)、特急指定席這類要先買票的交通,寫入 set_leg 時一併判斷 bookingType(通常 ticket_required)並附官方訂票連結;成員可在畫面上直接切換已購票狀態。
- 交通:成員問「A 到 B 怎麼去」→ 有 Google 時先 get_directions 拿真實路線與班次,再用 present_transit_options 呈現比較卡片(每個選項附好 legOp,成員點選即自動套用,不必再提案);成員已指定交通方式時,直接在提案中用 set_leg 寫入 mode、班次(transit.summary/steps)與出發抵達時間。
- 附圖:推薦店家/景點時附 1 張照片讓大家有畫面 — get_place_details 回傳的 photoRefs 可直接嵌進回覆,語法 ![店名](gphoto:<photoRefs 其中一項>),放在該店段落開頭;每則訊息最多 4 張,不要為附圖多查詳情。公開的 https 圖片網址也可以,載不出來會自動隱藏。
- 查證:優先 get_place_details(營業時間/評分/照片),官網公告等細節用 WebSearch/WebFetch 補足;查證完用 report_verification 記錄結論與來源,或在提案中帶 set_verification。**查證結論必須附上實際查過的來源連結(url+title),沒有來源的查證不成立**;成員也可能指名某個地點或交通請你查證,照樣附來源。
- 預約:新增景點/餐廳時主動判斷是否需預約或購票,在 add_stop/update_stop 帶 bookingType 與 booking(platform/url/onSaleDate/deadline/price/note);成員問「哪些要先預約」→ 逐點查證後用 present_booking_audit 總結呈現。**bookingStatus 絕不自行標成 booked(已預約/已購票)或 unavailable — 你無法替成員完成預約**:一律維持 not_booked 並提醒成員要先訂;只有成員明確說「已經訂好了」才可標 booked,且要在回覆中說明是依成員告知標記的。
- 地點:search_places 拿 placeId(地點會自動帶座標與照片);get_google_status 顯示未設定時,改用 WebSearch 查資料、地點以名稱+地址建立。
- 圖片:成員附圖時,訊息裡會附檔案路徑,用 Read 讀取。
- 版本:list_versions 可回顧誰改了什麼;成員可自行在畫面上回滾,你不用代勞。
- 被中止後:若上一輪回覆被成員中止,你下一輪要根據新訊息判斷 — 成員要你「繼續」就接著完成剛才沒做完的事(先讀行程確認目前狀態),換了方向就放下之前的工作照新指示做,不確定就先用一句話確認。
- 主動除錯:get_itinerary 回傳的 issues 會列出「時間順序衝突的地點」與「需重新確認的交通段」(成員移動地點或改時間後系統自動標記)。每次讀行程都留意這些問題並主動處理:答案明顯(如調整一個時間、補一段交通)就直接提案修正;需要成員拍板(如兩個安排擇一、要動哪個地點)就用 present_choices 給 2-4 個選項,並在每個選項附上 operations 讓成員點選即套用 — 系統會記錄是誰選的並告知你結果。

提案撰寫要點:
- 一批提案一個明確意圖,summary 一句話講清楚;大改拆成多個提案,讓成員能分別裁決。
- 只用 get_itinerary 回傳的真實 id;同批新建的實體用 $tempId 前向引用。
- 排入地點時一併補 set_leg(交通方式與時間),讓時間軸完整可執行。

# 表達
- 一律繁體中文(台灣用語);精簡、資訊密度高、重點在前,不冗長客套。
- 引用查證來源時給連結;數字(時間/費用)標明是實查還是概估。`;

async function runJob(job: { id: string; trip_id: string; chat_message_id: string }) {
  const tripId = job.trip_id;
  const userMsg = getMessage(job.chat_message_id);
  if (!userMsg) {
    db.run("UPDATE agent_jobs SET status='error', finished_at=? WHERE id=?", [now(), job.id]);
    return;
  }

  db.run("UPDATE agent_jobs SET status='running', started_at=? WHERE id=?", [now(), job.id]);
  db.run("UPDATE chat_messages SET status='complete' WHERE id=?", [userMsg.id]);

  const model = getSetting("agent_model");
  const assistant = insertMessage({
    tripId,
    role: "assistant",
    userId: userMsg.userId, // 發起者(歸屬顯示「AI · 小明發起」)
    status: "streaming",
    model,
    replyToMessageId: userMsg.id,
  });

  const jobToken = mintJobToken({
    tripId,
    chatMessageId: assistant.id,
    requestedByUserId: userMsg.userId,
  });

  const state: StreamState = {
    jobId: job.id,
    tripId,
    messageId: assistant.id,
    requestedByUserId: userMsg.userId ?? "",
    proc: null,
    jobToken,
    blockCount: 0,
    liveText: "",
    fullText: "",
    toolIdx: new Map(),
    phase: "thinking",
    stopping: false,
    stoppedBy: null,
    watchdog: null,
    stderrTail: [],
  };
  active = state;

  publish(tripId, {
    type: "chat_started",
    userMessageId: userMsg.id,
    message: getMessage(assistant.id),
    queue: queueInfo(),
  });
  publish(tripId, { type: "agent_status", state: "thinking" });
  setAgentFocus(tripId, null, true);

  // workspace cwd(空 CLAUDE.md 擋住向上搜尋 — catclaw 教訓)
  const cwd = join(WORKSPACE_ROOT, tripId);
  mkdirSync(cwd, { recursive: true });
  await Bun.write(join(cwd, "CLAUDE.md"), "");

  const trip = db
    .query("SELECT agent_session_id FROM trips WHERE id = ?")
    .get(tripId) as { agent_session_id: string | null };

  const stallMs = Math.max(60, Number(getSetting("agent_stall_timeout_sec")) || 300) * 1000;
  const resetWatchdog = () => {
    if (state.watchdog) clearTimeout(state.watchdog);
    state.watchdog = setTimeout(() => {
      state.stderrTail.push("[watchdog] 逾時無回應");
      state.stopping = true;
      state.proc?.kill("SIGKILL");
    }, stallMs);
  };

  const spawnOnce = (sessionArg: string[]): ReturnType<typeof Bun.spawn> => {
    const args = [
      "claude",
      "-p",
      buildPrompt(tripId, userMsg),
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      ...sessionArg,
      "--model",
      model,
      // 權限收緊(實測驗證):不用 skip-permissions;--tools 限縮內建工具集,
      // --allowedTools 為自動核准清單 — Read 只放行附件目錄(// 前綴=絕對路徑、字面比對),
      // 非互動模式下清單外的工具呼叫直接被拒,agent 碰不到本機其他檔案、不能執行指令。
      "--tools",
      "Read,WebSearch,WebFetch",
      "--allowedTools",
      "WebSearch",
      "WebFetch",
      "mcp__tabimate",
      `Read(//${ATTACH_ROOT.replace(/^\/+/, "")}/**)`,
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          tabimate: {
            type: "http",
            url: GATEWAY_MCP_URL,
            headers: { Authorization: `Bearer ${jobToken}` },
          },
        },
      }),
      "--strict-mcp-config",
      "--append-system-prompt",
      buildAgentSystemPrompt(tripId),
      "--autocompact",
      "auto",
      "--max-turns",
      String(Number(getSetting("agent_max_turns")) || 50),
    ];
    return Bun.spawn(args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
  };

  let sessionId = trip.agent_session_id;
  let usedResume = !!sessionId;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    db.run("UPDATE trips SET agent_session_id = ? WHERE id = ?", [sessionId, tripId]);
  }

  let exitCode: number | null = null;
  let gotResult = false;

  const consume = async (proc: ReturnType<typeof Bun.spawn>) => {
    state.proc = proc;
    resetWatchdog();

    // stderr tail
    (async () => {
      const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) if (l.trim()) state.stderrTail.push(l.slice(0, 400));
        if (state.stderrTail.length > 10) state.stderrTail.splice(0, state.stderrTail.length - 10);
      }
    })();

    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        resetWatchdog();
        let ev: Record<string, never>;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        handleEvent(state, ev as never, () => {
          gotResult = true;
        });
      }
    }
    exitCode = await proc.exited;
  };

  try {
    await consume(spawnOnce(usedResume ? ["--resume", sessionId] : ["--session-id", sessionId]));

    // --resume 失敗(session 檔遺失等):fresh session 重試一次
    if (!gotResult && usedResume && !state.stopping && exitCode !== 0) {
      const freshId = crypto.randomUUID();
      db.run("UPDATE trips SET agent_session_id = ? WHERE id = ?", [freshId, tripId]);
      const sysMsg = insertMessage({
        tripId,
        role: "system",
        content: "對話脈絡已重置(先前的 session 無法恢復)。",
      });
      publish(tripId, { type: "chat_message", message: sysMsg });
      usedResume = false;
      state.stderrTail = [];
      await consume(spawnOnce(["--session-id", freshId]));
    }
  } catch (e) {
    state.stderrTail.push(String(e).slice(0, 300));
  } finally {
    if (state.watchdog) clearTimeout(state.watchdog);
    revokeJobToken(jobToken);
    setAgentFocus(tripId, null, false);
  }

  // 收尾
  flushLiveText(state);
  if (state.stopping && state.stoppedBy) {
    finalizeMessage(assistant.id, "stopped", { content: state.fullText, sessionId });
    db.run("UPDATE agent_jobs SET status='stopped', finished_at=? WHERE id=?", [now(), job.id]);
    publish(tripId, {
      type: "chat_stopped",
      messageId: assistant.id,
      byUserId: state.stoppedBy,
    });
    addFeedback(tripId, `${userName(state.stoppedBy)} 中止了你上一輪的回覆。`);
  } else if (gotResult) {
    finalizeMessage(assistant.id, "complete", { content: state.fullText, sessionId });
    db.run("UPDATE agent_jobs SET status='done', finished_at=? WHERE id=?", [now(), job.id]);
    publish(tripId, { type: "chat_done", messageId: assistant.id, status: "complete" });
  } else {
    const errText =
      state.stderrTail.length > 0 ? state.stderrTail.join("\n").slice(-600) : `程序結束(code ${exitCode})`;
    finalizeMessage(assistant.id, "error", { content: state.fullText, error: errText, sessionId });
    db.run("UPDATE agent_jobs SET status='error', finished_at=? WHERE id=?", [now(), job.id]);
    publish(tripId, { type: "chat_error", messageId: assistant.id, error: errText });
  }
  publish(tripId, { type: "agent_status", state: "idle" });
  active = null;
}

function handleEvent(
  s: StreamState,
  ev: { type: string } & Record<string, unknown>,
  onResult: () => void,
) {
  switch (ev.type) {
    case "system":
      break;
    case "stream_event": {
      const e = ev.event as { type: string } & Record<string, never>;
      if (!e) break;
      if (e.type === "content_block_start") {
        const cb = (e as { content_block?: { type: string; name?: string; id?: string } })
          .content_block;
        if (cb?.type === "tool_use" && cb.name) {
          // 工具開跑:先出現 running 狀態(input 之後由 assistant 事件補)
          flushLiveText(s);
          const block: ChatBlock = {
            kind: "tool_status",
            toolCallId: cb.id ?? newId(),
            tool: cb.name,
            label: toolLabel(cb.name, null),
            state: "running",
          };
          s.toolIdx.set(block.toolCallId, s.blockCount);
          insertBlock(s.messageId, s.blockCount, block);
          publish(s.tripId, {
            type: "chat_block",
            messageId: s.messageId,
            idx: s.blockCount,
            block,
          });
          s.blockCount++;
          s.phase = "tool";
          publish(s.tripId, { type: "agent_status", state: "tool", label: block.label });
        } else if (cb?.type === "thinking") {
          s.phase = "thinking";
          publish(s.tripId, { type: "agent_status", state: "thinking" });
        }
      } else if (e.type === "content_block_delta") {
        const delta = (e as { delta?: { type: string; text?: string } }).delta;
        if (delta?.type === "text_delta" && delta.text) {
          if (s.phase !== "streaming") {
            s.phase = "streaming";
            publish(s.tripId, { type: "agent_status", state: "streaming" });
          }
          s.liveText += delta.text;
          publish(s.tripId, {
            type: "chat_delta",
            messageId: s.messageId,
            idx: s.blockCount,
            text: delta.text,
          });
        }
      }
      break;
    }
    case "assistant": {
      // 完整 assistant 訊息:定稿 text block、補齊 tool_use 的 input/label
      const msg = ev.message as {
        content?: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
        >;
      };
      for (const cb of msg?.content ?? []) {
        if (cb.type === "text") {
          // 以完整文字取代累積的 live text(對齊 partial 誤差)
          if (cb.text) {
            s.liveText = cb.text;
            flushLiveText(s);
          }
        } else if (cb.type === "tool_use") {
          const idx = s.toolIdx.get(cb.id);
          if (idx != null) {
            const blocks = getMessage(s.messageId)?.blocks ?? [];
            const prev = blocks[idx];
            if (prev?.kind === "tool_status") {
              const updated: ChatBlock = {
                ...prev,
                label: toolLabel(cb.name, cb.input ?? null),
              };
              updateBlock(s.messageId, idx, updated);
              publish(s.tripId, {
                type: "chat_block",
                messageId: s.messageId,
                idx,
                block: updated,
              });
              publish(s.tripId, { type: "agent_status", state: "tool", label: updated.label });
            }
          }
        }
      }
      break;
    }
    case "user": {
      // tool results:標記 done/failed
      const msg = ev.message as {
        content?: Array<{
          type: string;
          tool_use_id?: string;
          is_error?: boolean;
          content?: unknown;
        }>;
      };
      for (const cb of msg?.content ?? []) {
        if (cb.type === "tool_result" && cb.tool_use_id) {
          const idx = s.toolIdx.get(cb.tool_use_id);
          if (idx != null) {
            const blocks = getMessage(s.messageId)?.blocks ?? [];
            const prev = blocks[idx];
            if (prev?.kind === "tool_status" && prev.state === "running") {
              // 失敗時把工具回傳的錯誤原文帶上(白話,使用者看得懂原因)
              let detail: string | undefined;
              if (cb.is_error) {
                const c = cb.content as unknown;
                const text = Array.isArray(c)
                  ? (c as Array<{ text?: string }>).map((x) => x.text ?? "").join(" ")
                  : typeof c === "string"
                    ? c
                    : "";
                detail = text.replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
              }
              const updated: ChatBlock = {
                ...prev,
                state: cb.is_error ? "failed" : "done",
                detail,
              };
              updateBlock(s.messageId, idx, updated);
              publish(s.tripId, {
                type: "chat_block",
                messageId: s.messageId,
                idx,
                block: updated,
              });
            }
          }
        }
      }
      break;
    }
    case "result": {
      onResult();
      const subtype = (ev as { subtype?: string }).subtype;
      if (subtype && subtype !== "success") {
        const label =
          subtype === "error_max_turns"
            ? "已達單輪最大回合數,回覆可能不完整。"
            : `結束狀態:${subtype}`;
        const block: ChatBlock = { kind: "error", message: label };
        flushLiveText(s);
        insertBlock(s.messageId, s.blockCount, block);
        publish(s.tripId, {
          type: "chat_block",
          messageId: s.messageId,
          idx: s.blockCount,
          block,
        });
        s.blockCount++;
      }
      break;
    }
  }
}

async function pump() {
  if (pumping || active) return;
  pumping = true;
  try {
    while (!active) {
      const job = db
        .query(
          "SELECT id, trip_id, chat_message_id FROM agent_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1",
        )
        .get() as { id: string; trip_id: string; chat_message_id: string } | null;
      if (!job) break;
      await runJob(job);
      publish(job.trip_id, { type: "queue", queue: queueInfo() });
    }
  } catch (e) {
    console.error("[runner] pump error:", e);
    active = null;
  } finally {
    pumping = false;
    // runJob 期間可能又進了新 job
    const pending = db
      .query("SELECT COUNT(*) AS c FROM agent_jobs WHERE status='queued'")
      .get() as { c: number };
    if (pending.c > 0 && !active) queueMicrotask(pump);
  }
}

export function initRunner() {
  recoverJobsOnBoot();

  const check = Bun.spawnSync(["claude", "--version"]);
  claudeAvailable = check.exitCode === 0;
  claudeVersion = claudeAvailable ? new TextDecoder().decode(check.stdout).trim() : "";
  console.log(
    claudeAvailable
      ? `[runner] claude CLI 可用:${claudeVersion}`
      : "[runner] claude CLI 不可用,agent 功能停用",
  );

  setAgentStateProvider(getAgentState);

  // 提案裁決 → 下一輪 context 回饋
  subscribe((tripId, event) => {
    if (event.type === "proposal_resolved") {
      const status = event.status as string;
      const by = userName((event.resolvedByUserId as string) ?? null);
      const label =
        status === "applied"
          ? `你先前的提案已由 ${by} 確認並套用。`
          : status === "rejected"
            ? `你先前的提案被 ${by} 拒絕${event.note ? `:${event.note}` : "。"}`
            : status === "failed_conflict"
              ? "你先前的提案因行程已變動而套用失敗,請重新讀取行程後再評估。"
              : null;
      if (label) addFeedback(tripId, label);
    }
    // 使用者直接編輯與回滾不在這裡記 feedback:buildPrompt 開場會用
    // trips.agent_last_rev 比對 versions 表列出期間所有變更(重啟不丟、不會被截斷)。
  });

  queueMicrotask(pump);
}

/** 記憶確認卡被處理後,由 route 呼叫寫回饋。 */
export function noteMemoryResolution(
  tripId: string,
  byUserId: string,
  content: string,
  saved: boolean,
) {
  addFeedback(
    tripId,
    saved
      ? `${userName(byUserId)} 確認了你的記憶請求,已寫入:「${content}」`
      : `${userName(byUserId)} 婉拒了你的記憶請求:「${content}」(不要再重複提出)`,
  );
}

/** 交通選項選擇後,由 route 呼叫寫回饋。 */
export function noteTransitSelection(tripId: string, byUserId: string, optionLabel: string) {
  addFeedback(tripId, `${userName(byUserId)} 選擇了交通方式:${optionLabel},系統已直接套用。`);
}

/** 通用選項卡選擇後,由 route 呼叫寫回饋。 */
export function noteUserChoice(
  tripId: string,
  byUserId: string,
  question: string,
  optionLabel: string,
  applied: boolean,
) {
  addFeedback(
    tripId,
    `${userName(byUserId)} 在「${question}」選擇了「${optionLabel}」${applied ? ",對應變更已直接套用。" : "。"}`,
  );
}
