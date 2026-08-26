// MCP 工具實作。核心:get_itinerary / get_trip_info / propose_changes / list_versions。
// 呈現型:present_transit_options / report_verification / present_booking_audit。
// Google 系(search_places / get_place_details / get_directions)在 M6 註冊。
import { z } from "zod";

import type { Operation } from "../../shared/changeset";
import { applyOperations, ChangesetError } from "../../shared/changeset";
import { detectTimeConflicts } from "../../shared/conflicts";
import type { ChatBlock } from "../../shared/types";
import { publish } from "../bus";
import { db, newId } from "../db";
import { registerTool } from "../mcp";
import { createProposal } from "../proposals";
import { getTripRow, listVersions, loadDoc, tripMeta } from "../itinerary";
import { getSetting } from "../settings";
import { setAgentFocus } from "../ws";
import { appendRichBlock } from "./runner";

const OPERATIONS_DOC = `每個 operation 是一個物件,op 欄位決定種類:
- {"op":"add_day","tempId?":"d1","position?":0,"title?":"...","note?":"..."} 新增一天(position 省略=附加在最後)
- {"op":"update_day","dayId":"...","patch":{"title?","note?","lodgingDepartTime?":"09:30","lodgingReturnTime?":"21:00","lodgingMorningLeg?":{...或 null},"lodgingEveningLeg?":{...或 null}}}(lodging* 欄位=續住日的住宿錨點,見下方住宿語意)
- {"op":"move_day","dayId":"...","position":0}
- {"op":"remove_day","dayId":"..."} (連同該天所有地點)
- {"op":"add_stop","tempId?":"s1","dayId":"...","position?":0,"name":"淺草寺","category?":"sight","startTime?":"09:00","endTime?":"10:30","placeId?":"...","lat?":35.7,"lng?":139.8,"address?":"...","notes?":"...","bookingType?":"reservation_required","booking?":{...}} 分類:lodging|food|cafe|sight|shopping|activity|transit-hub|other
- {"op":"update_stop","stopId":"...","patch":{任意 stop 欄位,含 bookingType/bookingStatus/booking}}
- {"op":"move_stop","stopId":"...","toDayId":"...","position":0}
- {"op":"remove_stop","stopId":"..."}
- {"op":"set_leg","fromStopId":"...","mode":"transit","durationMin?":25,"departureTime?":"14:03","arrivalTime?":"14:28","transit?":{"summary":"JR山手線","steps":[...],"fare":"¥170"},"notes?":"..."} 交通段掛在出發地點上,目的地自動是下一站。mode:walk|transit|drive|taxi|bike|flight|other
- {"op":"remove_leg","fromStopId":"..."}
- {"op":"set_verification","stopId":"...","status":"verified|stale|unverified","sources":[{"url":"...","title":"...","checkedAt":0}]} — verified/stale **必須附至少一筆真實來源**(成員要能點開對照),否則整包提案會被拒
- {"op":"update_trip","patch":{"title?","destination?","startDate?":"YYYY-MM-DD"}}
dayId/stopId 用 get_itinerary 回傳的真實 id;同一批內先新增的實體可用 "$tempId" 引用。
booking 物件欄位:platform/url/confirmationCode/price/onSaleDate/deadline/note。
bookingType:none|reservation_required(不訂進不去)|ticket_required(要先買票)|recommended(建議預約)|walk_in_queue(現場排隊)。
住宿跨夜語意(平台特例,務必理解):
- lodging 的 startTime=入住、endTime=「退房日早上的退房時間」(可早於 startTime,合法);**nights=住幾晚**(如 D1 入住住到 D4 晚、D5 退房 → nights:4)。住宿只放在入住那天並設好 nights,不要在其他天重複新增同一間。
- 續住的每一天,畫面會自動在當天「最上方」顯示住宿錨點(昨晚住這)、中間天「最下方」也有(今晚回這裡住)。這些錨點不是 stop,對應資料存在那一天(day)上:
  - day.lodgingDepartTime = 那天早上幾點離開住宿(退房日不用這欄,以住宿的 endTime 為準)
  - day.lodgingReturnTime = 中間天晚上幾點回到住宿
  - day.lodgingMorningLeg = 住宿→當天第一個行程的交通;day.lodgingEveningLeg = 最後一個行程→住宿的交通。格式:{"mode":"walk|transit|drive|taxi|bike|flight|other","durationMin":15,"departureTime":"10:00","arrivalTime":"10:15","transit":{同 set_leg 的 transit,可含 summary/steps/fare},"notes":""};設 null 清除
  - 全部用 update_day 的 patch 寫入。範例「明天十點離開飯店搭公車去吃早餐」→ update_day 那天 {"lodgingDepartTime":"10:00","lodgingMorningLeg":{"mode":"transit","departureTime":"10:00","arrivalTime":"10:20","durationMin":20,"transit":{"summary":"都營巴士 ..."},"notes":""}}
- 排程檢查:第一個行程早於離開時間、最後一個行程結束晚於回到時間,都會被列入 timeConflictStopIds。
- 入住日「最後行程→住宿」是普通 leg(住宿是當天真實 stop,用 set_leg);退房日早上的「住宿→首行程」交通用 lodgingMorningLeg。
- 入住日「先到飯店放行李再出門」:住宿 stop 放在它實際的時間位置(如 15:00),之後照排晚上行程;只要住宿不在當天末位,畫面結尾會自動出現「今晚回這裡住」錨列,晚上回程時間/交通一樣用 update_day 的 lodgingReturnTime/lodgingEveningLeg。不要為了收尾把住宿硬移到最後。
- **住宿主卡 = 入住日排序最前的那張 lodging 卡**(check-in/退房/nights 都設定在它身上);同一天在主卡之後再出現的 lodging(以及續住日的任何 lodging)都是「回飯店」輕量卡(中途休息/放戰利品),startTime/endTime 設當天時段即可,不影響續住判定。真正的過夜住宿永遠只有入住那天的主卡那一筆。\n- 主卡不必是當天最後一項:主卡在末位=晚上直接到飯店收尾;主卡之後還有行程時畫面結尾會自動出現「今晚回這裡住」錨列。`;

export function registerCoreTools() {
  registerTool({
    name: "get_itinerary",
    description:
      "取得整份行程(days/stops/legs 完整 JSON 與所有 id)與目前版本號 itineraryRev。任何修改前先呼叫這個拿最新狀態。回傳另含 issues:timeConflictStopIds(時間與前後順序衝突的地點,畫面上會對成員顯示警示)與 legsNeedingReview(相鄰地點被移動/改時間後需重新確認的交通段)— 發現這些問題時主動處理:能自行判斷就直接提案修正,需要成員拍板就用 present_choices。",
    schema: z.object({}),
    handler: (_args, job) => {
      const { row, doc } = loadDoc(job.tripId);
      return {
        itineraryRev: row.itinerary_rev,
        trip: doc.trip,
        days: doc.days,
        stops: doc.stops,
        legs: doc.legs,
        issues: {
          timeConflictStopIds: [...detectTimeConflicts(doc.days, doc.stops)],
          legsNeedingReview: doc.legs
            .filter((l) => l.needsReview)
            .map((l) => ({ fromStopId: l.fromStopId, toStopId: l.toStopId })),
        },
      };
    },
  });

  registerTool({
    name: "get_trip_info",
    description: "取得行程基本資訊(名稱、目的地、出發日期)與成員名單。",
    schema: z.object({}),
    handler: (_args, job) => {
      const trip = tripMeta(getTripRow(job.tripId));
      const members = db
        .query("SELECT id, name FROM users WHERE trip_id = ? AND is_active = 1")
        .all(job.tripId) as Array<{ id: string; name: string }>;
      return { trip, members };
    },
  });

  registerTool({
    name: "propose_changes",
    description:
      "對行程提出變更提案。這是唯一可以修改行程的方式:提案會顯示在所有成員的畫面上等待任一人確認,確認後才會套用。呼叫後立即返回 pending 狀態 — 絕對不要宣稱變更已生效,告訴使用者請在畫面上確認提案即可;裁決結果會在你的下一輪對話開頭告知。\n\n" +
      OPERATIONS_DOC,
    schema: z.object({
      summary: z
        .string()
        .min(1)
        .describe("一句話描述這批變更(顯示在提案卡上),例如「把東京鐵塔排進 Day 2 下午」"),
      operations: z
        .array(z.looseObject({ op: z.string() }))
        .min(1)
        .describe("Operation 陣列,格式見工具描述"),
    }),
    handler: (args, job) => {
      const { proposal } = createProposal({
        tripId: job.tripId,
        summary: args.summary,
        operations: args.operations as unknown as Operation[],
        requestedByUserId: job.requestedByUserId,
        chatMessageId: job.chatMessageId,
      });
      // 提案範圍高亮:agent 正在動這些點
      const stopIds = (proposal.operations as Operation[])
        .map((o) =>
          "stopId" in o
            ? o.stopId
            : "fromStopId" in o
              ? o.fromStopId
              : null,
        )
        .filter((x): x is string => !!x && !x.startsWith("$"));
      if (stopIds.length > 0) {
        setAgentFocus(job.tripId, { stopId: stopIds[0] }, true);
      }
      // 提案卡片插進正在串流的回覆(確認/拒絕按鈕就在聊天室裡)
      appendRichBlock(job.tripId, { kind: "proposal", proposalId: proposal.id });
      return {
        proposalId: proposal.id,
        status: "pending_user_confirmation",
        message: "提案已送出,等待成員在畫面上確認。",
      };
    },
  });

  registerTool({
    name: "present_transit_options",
    description:
      "把兩點之間的交通方式選項以精美比較卡片呈現在聊天室,讓成員直接點選;成員點選後系統會自動套用對應的交通段,不需要再提案。每個選項要附上現成的 set_leg operation(legOp)。適用情境:成員問「A到B有哪些交通方式」或你想讓成員在多個方案之間做選擇。",
    schema: z.object({
      from: z.string().describe("出發地點名稱"),
      to: z.string().describe("目的地名稱"),
      options: z
        .array(
          z.object({
            mode: z.enum(["walk", "transit", "drive", "taxi", "bike", "flight", "other"]),
            label: z.string().describe("選項名稱,如「電車」「巴士」「計程車」"),
            durationMin: z.number().describe("所需時間(分鐘)"),
            fare: z.string().optional().describe("費用,如「¥170」"),
            transfers: z.number().optional().describe("轉乘次數"),
            summary: z.string().describe("一句話摘要,如「JR山手線 澀谷→新宿,4 站」"),
            departureTime: z.string().optional().describe("建議出發時刻 HH:MM"),
            arrivalTime: z.string().optional().describe("預計抵達時刻 HH:MM"),
            recommended: z.boolean().optional().describe("是否為你推薦的選項(最多一個)"),
            legOp: z
              .looseObject({ op: z.string() })
              .describe("點選後要套用的完整 set_leg operation(含 fromStopId)"),
          }),
        )
        .min(1)
        .max(5),
    }),
    handler: (args, job) => {
      const block: ChatBlock = {
        kind: "transit_options",
        blockId: newId(),
        from: args.from,
        to: args.to,
        options: args.options.map((o) => ({
          mode: o.mode,
          label: o.label,
          durationMin: o.durationMin,
          fare: o.fare,
          transfers: o.transfers,
          summary: o.summary,
          departureTime: o.departureTime,
          arrivalTime: o.arrivalTime,
          recommended: o.recommended,
          legOp: o.legOp,
        })),
        selectedIndex: null,
        selectedByUserId: null,
      };
      const placed = appendRichBlock(job.tripId, block);
      if (!placed) return { error: "沒有進行中的回覆,無法呈現卡片" };
      return {
        ok: true,
        message: "選項卡片已顯示,成員點選後系統會自動套用,結果會在你下一輪對話開頭告知。",
      };
    },
  });

  registerTool({
    name: "present_choices",
    description:
      "需要成員做決策時,以選項卡片呈現在聊天室讓任一成員點選(例如:時間衝突要保留哪個安排、兩個景點擇一、要不要把某天行程順延)。每個選項可附上 operations(格式同 propose_changes),成員點選後系統直接套用該選項的變更並記錄是誰選的;不附 operations 則純粹是回答。點選結果會在你下一輪對話開頭告知。選項給 2-4 個,label 簡短、description 講清楚後果。",
    schema: z.object({
      question: z.string().min(1).describe("要成員決定的問題,一句話"),
      options: z
        .array(
          z.object({
            label: z.string().min(1).describe("選項名稱(短)"),
            description: z.string().optional().describe("這個選項的後果說明"),
            operations: z
              .array(z.looseObject({ op: z.string() }))
              .optional()
              .describe("點選後要套用的變更(可省略=純回答)"),
          }),
        )
        .min(2)
        .max(4),
    }),
    handler: (args, job) => {
      // 附了 operations 的選項先 dry-run,壞掉的 ops 直接退回給 agent
      const { doc } = loadDoc(job.tripId);
      for (const [i, opt] of args.options.entries()) {
        if (opt.operations?.length) {
          try {
            applyOperations(doc, opt.operations as unknown as Operation[], {
              tripId: job.tripId,
              actorUserId: job.requestedByUserId,
              now: Date.now(),
              newId: () => newId(),
            });
          } catch (e) {
            if (e instanceof ChangesetError) {
              return { error: `選項 ${i + 1}「${opt.label}」的 operations 無效:${e.message}` };
            }
            throw e;
          }
        }
      }
      const block: ChatBlock = {
        kind: "choices",
        blockId: newId(),
        question: args.question,
        options: args.options.map((o) => ({
          label: o.label,
          description: o.description,
          operations: o.operations,
        })),
        selectedIndex: null,
        selectedByUserId: null,
      };
      const placed = appendRichBlock(job.tripId, block);
      if (!placed) return { error: "沒有進行中的回覆,無法呈現卡片" };
      return {
        ok: true,
        message: "選項卡已顯示,成員點選後結果會在你下一輪對話開頭告知。",
      };
    },
  });

  registerTool({
    name: "report_verification",
    description:
      "回報對某個地點的查證結果(營業時間/休息日等),會以查證卡片顯示在聊天室,並直接更新該地點的查證狀態與來源(這是安全的中繼資料,不需要提案)。",
    schema: z.object({
      stopId: z.string().describe("行程中的地點 id(get_itinerary 取得)"),
      verdict: z
        .enum(["confirmed", "mismatch", "unknown"])
        .describe("confirmed=資訊正確可去|mismatch=與行程安排衝突(如公休)|unknown=查不到可靠資訊"),
      hours: z.array(z.string()).optional().describe("查到的營業時間,每天一行"),
      note: z.string().optional().describe("補充說明,如「週三公休,行程排在週三需調整」"),
      sources: z
        .array(z.object({ url: z.string(), title: z.string() }))
        .min(1)
        .describe("查證來源連結"),
    }),
    handler: (args, job) => {
      const { doc } = loadDoc(job.tripId);
      const stop = doc.stops.find((s) => s.id === args.stopId);
      if (!stop) return { error: `找不到地點 ${args.stopId}` };
      const checkedAt = Date.now();
      // 直接更新查證中繼資料(不進版本歷史,避免灌水)
      db.run(
        "UPDATE stops SET verify_status = ?, verify_sources = ?, verified_at = ? WHERE id = ?",
        [
          args.verdict === "confirmed" ? "verified" : args.verdict === "mismatch" ? "stale" : "unverified",
          JSON.stringify(args.sources.map((s) => ({ ...s, checkedAt }))),
          args.verdict === "confirmed" ? checkedAt : null,
          args.stopId,
        ],
      );
      publish(job.tripId, { type: "itin_meta_changed", stopIds: [args.stopId] });
      setAgentFocus(job.tripId, { stopId: args.stopId }, true);
      const block: ChatBlock = {
        kind: "verification",
        stopId: args.stopId,
        place: stop.name,
        verdict: args.verdict,
        hours: args.hours,
        note: args.note,
        sources: args.sources,
      };
      appendRichBlock(job.tripId, block);
      return { ok: true, message: "查證結果已記錄並顯示。" };
    },
  });

  registerTool({
    name: "present_booking_audit",
    description:
      "以預約稽核卡片呈現整趟行程需要預約/購票的項目清單(哪些沒訂會撲空、截止日、訂票連結、目前狀態)。適用:成員問「有哪些要先預約」時,先逐點查證再用這個工具總結呈現。要更新某地點的預約標記請另外用 propose_changes 的 update_stop。",
    schema: z.object({
      items: z
        .array(
          z.object({
            stopId: z.string().nullable().describe("對應行程地點 id;不在行程內的建議項目給 null"),
            name: z.string(),
            dayLabel: z.string().optional().describe("如「Day 2」"),
            bookingType: z.enum([
              "none",
              "reservation_required",
              "ticket_required",
              "recommended",
              "walk_in_queue",
            ]),
            bookingStatus: z.enum(["not_booked", "booked", "unavailable"]),
            requirement: z.string().describe("一句話說明,如「需在官網預約,每月10日開賣下月票」"),
            deadline: z.string().optional().describe("截止/開賣日 YYYY-MM-DD"),
            url: z.string().optional().describe("訂票/預約網址"),
            sources: z.array(z.object({ url: z.string(), title: z.string() })).optional(),
          }),
        )
        .min(1),
    }),
    handler: (args, job) => {
      const block: ChatBlock = { kind: "booking_audit", items: args.items };
      const placed = appendRichBlock(job.tripId, block);
      if (!placed) return { error: "沒有進行中的回覆,無法呈現卡片" };
      return { ok: true, message: "預約稽核卡已顯示。" };
    },
  });

  registerTool({
    name: "search_places",
    description:
      "用 Google Places 搜尋地點,回傳 placeId 與名稱地址(繁中)。找到的 placeId 可放進 add_stop/update_stop 讓地點帶座標與照片。Google 未設定時會告知,改用 WebSearch。",
    schema: z.object({
      query: z.string().min(1).describe("搜尋文字,如「東京鐵塔」「澀谷 燒肉」"),
      near: z
        .object({ lat: z.number(), lng: z.number() })
        .optional()
        .describe("以此座標為中心偏好搜尋(通常用行程內既有地點的座標)"),
    }),
    handler: async (args, _job) => {
      const g = await import("../google");
      try {
        const { results } = await g.autocomplete(args.query, args.near);
        return { results };
      } catch (e) {
        if (e instanceof g.GoogleUnconfigured) {
          return { error: "Google 地圖尚未設定,請改用 WebSearch 查資料,地點以名稱+地址手動建立。" };
        }
        if (e instanceof g.GoogleQuotaExhausted) {
          return { error: "本月 Google 呼叫額度已用完(保護免費額度),請改用 WebSearch 查資料,下個月自動恢復。" };
        }
        throw e;
      }
    },
  });

  registerTool({
    name: "get_place_details",
    description:
      "取得 Google 地點詳細資訊:座標、地址、評分、營業時間、照片、官網、電話。placeId 來自 search_places 或行程中地點的 placeId 欄位。查證營業時間時優先用這個,再用 WebSearch 補足(如公休日、預約規則)。回傳的 photoRefs 可用 ![名稱](gphoto:<ref>) 語法嵌在聊天回覆裡顯示照片。",
    schema: z.object({
      placeId: z.string().min(1),
      stopId: z.string().optional().describe("若是在查證行程中的某個地點,附上該 stopId"),
    }),
    handler: async (args, job) => {
      const g = await import("../google");
      if (args.stopId) setAgentFocus(job.tripId, { stopId: args.stopId }, true);
      try {
        const { place } = await g.placeDetails(args.placeId);
        return { place };
      } catch (e) {
        if (e instanceof g.GoogleUnconfigured) {
          return { error: "Google 地圖尚未設定,請改用 WebSearch 查營業時間與地址。" };
        }
        if (e instanceof g.GoogleQuotaExhausted) {
          return { error: "本月 Google 呼叫額度已用完,請改用 WebSearch 查營業時間與地址,下個月自動恢復。" };
        }
        throw e;
      }
    },
  });

  registerTool({
    name: "get_directions",
    description:
      "查詢兩點之間的路線(Google Routes),回傳所有替代路線(altIndex 編號):時間、距離、大眾運輸班次(路線名/發車時刻/站數)、票價。用查到的資訊組 set_leg(transit.summary/steps/fare 直接沿用)或 present_transit_options。from/to 給 stopId(行程內地點)或 placeId 或座標。",
    schema: z.object({
      from: z.looseObject({}).describe('{"stopId":"…"} 或 {"placeId":"…"} 或 {"lat":35.7,"lng":139.8}'),
      to: z.looseObject({}).describe("同 from 格式"),
      mode: z.enum(["walk", "transit", "drive", "taxi", "bike"]).describe("交通方式"),
      departureTime: z.string().optional().describe("出發時刻 HH:MM(transit 建議提供以取得班次)"),
    }),
    handler: async (args, job) => {
      const g = await import("../google");
      const resolveWp = (
        w: Record<string, unknown>,
      ): import("../google").Waypoint => {
        if (typeof w.stopId === "string") {
          const { doc } = loadDoc(job.tripId);
          const stop = doc.stops.find((s) => s.id === w.stopId);
          if (!stop) throw new Error(`找不到地點 ${w.stopId}`);
          setAgentFocus(job.tripId, { stopId: stop.id }, true);
          if (stop.lat != null && stop.lng != null) return { lat: stop.lat, lng: stop.lng };
          if (stop.placeId) return { placeId: stop.placeId };
          return { address: stop.address ?? stop.name };
        }
        if (typeof w.placeId === "string") return { placeId: w.placeId };
        if (typeof w.lat === "number" && typeof w.lng === "number") {
          return { lat: w.lat, lng: w.lng };
        }
        if (typeof w.address === "string") return { address: w.address };
        throw new Error("from/to 需要 stopId、placeId、lat/lng 或 address");
      };
      try {
        const { alternatives, note } = await g.directions({
          from: resolveWp(args.from as Record<string, unknown>),
          to: resolveWp(args.to as Record<string, unknown>),
          mode: args.mode,
          departureTime: args.departureTime,
        });
        return { alternatives, ...(note ? { note } : {}) };
      } catch (e) {
        if (e instanceof g.GoogleUnconfigured) {
          return { error: "Google 地圖尚未設定,請改用 WebSearch 查交通方式與時刻表。" };
        }
        if (e instanceof g.GoogleQuotaExhausted) {
          return { error: "本月 Google 呼叫額度已用完,請改用 WebSearch 查交通方式與時刻表,下個月自動恢復。" };
        }
        throw e;
      }
    },
  });

  registerTool({
    name: "get_google_status",
    description: "檢查 Google 地圖服務是否已設定;未設定時地點搜尋/路線工具不可用,改用 WebSearch 查證。",
    schema: z.object({}),
    handler: () => ({
      configured: getSetting("google_maps_api_key") !== "",
    }),
  });

  registerTool({
    name: "list_versions",
    description: "列出行程版本歷史(誰在什麼時候做了什麼變更)。",
    schema: z.object({
      limit: z.number().int().min(1).max(100).optional().describe("最多回傳幾筆,預設 20"),
    }),
    handler: (args, job) => {
      const versions = listVersions(job.tripId, args.limit ?? 20);
      const users = db
        .query("SELECT id, name FROM users WHERE trip_id = ?")
        .all(job.tripId) as Array<{ id: string; name: string }>;
      const nameOf = new Map(users.map((u) => [u.id, u.name]));
      return {
        versions: versions.map((v) => ({
          rev: v.rev,
          summary: v.summary,
          changeKind: v.changeKind,
          actor: v.actorUserId ? (nameOf.get(v.actorUserId) ?? "成員") : null,
          agentInvolved: v.agentInvolved,
          createdAt: v.createdAt,
        })),
      };
    },
  });
}
