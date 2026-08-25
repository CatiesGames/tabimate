// M5 冒煙:真 claude -p 對話 → 工具呼叫 → 提案 → 確認 → 下一輪知道結果 → 中止 → resume 正常。
// 為省 token 測試時把模型切到 sonnet,結束後切回設定預設。
const GW = "http://127.0.0.1:4681";

async function post(path: string, body: unknown, cookie?: string) {
  const res = await fetch(GW + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as never, headers: res.headers };
}

// admin 登入 + 模型切到 sonnet
const adminLogin = await post("/api/admin/login", {
  username: process.env.ADMIN_USERNAME ?? "admin",
  password: process.env.ADMIN_PASSWORD ?? "tabimate-dev",
});
const adminCookie = adminLogin.headers.get("set-cookie")!.split(";")[0];
await fetch(GW + "/api/admin/settings", {
  method: "PUT",
  headers: { "content-type": "application/json", cookie: adminCookie },
  body: JSON.stringify({ agent_model: "claude-sonnet-5" }),
});

// 使用者登入
const trips = (await (await fetch(`${GW}/api/auth/trips`)).json()) as { trips: Array<{ id: string }> };
const tripId = trips.trips[0].id;
const users = (await (await fetch(`${GW}/api/auth/trips/${tripId}/users`)).json()) as {
  users: Array<{ id: string }>;
};
const login = await post("/api/auth/login", { userId: users.users[0].id, password: "pw1234" });
const cookie = login.headers.get("set-cookie")!.split(";")[0];

// WS
const t = (await (await fetch(`${GW}/api/auth/ws-ticket`, { headers: { cookie } })).json()) as {
  ticket: string;
};
const ws = new WebSocket(`ws://127.0.0.1:4681/ws?token=${t.ticket}`);
const events: Array<{ type?: string } & Record<string, never>> = [];
ws.onmessage = (ev) => events.push(JSON.parse(String(ev.data)));
await new Promise<void>((r) => (ws.onopen = () => r()));
ws.send('{"type":"sub"}');

function waitFor<T>(pred: (e: never) => boolean, label: string, ms = 180_000): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const hit = events.find((e) => pred(e as never));
      if (hit) (clearInterval(timer), resolve(hit as T));
      else if (Date.now() - start > ms)
        (clearInterval(timer), reject(new Error("timeout: " + label)));
    }, 100);
  });
}
const mark = () => events.length;
function waitForAfter<T>(from: number, pred: (e: never) => boolean, label: string, ms = 180_000): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const hit = events.slice(from).find((e) => pred(e as never));
      if (hit) (clearInterval(timer), resolve(hit as T));
      else if (Date.now() - start > ms)
        (clearInterval(timer), reject(new Error("timeout: " + label)));
    }, 100);
  });
}

// ---- 第 1 輪:請 agent 提案 ----
console.log("=== turn 1: 請 agent 提案加晚餐 ===");
await post(
  `/api/trips/${tripId}/chat`,
  { text: "請在第一天最後加一個晚餐地點:「一蘭拉麵 上野店」,分類 food,時間 19:00。不需要查網路,直接用工具讀行程然後提案即可。" },
  cookie,
);
await waitFor((e: { type?: string }) => e.type === "chat_started", "chat_started");
const prop = await waitFor<{ proposal: { id: string; summary: string } }>(
  (e: { type?: string }) => e.type === "proposal_new",
  "proposal_new",
);
console.log("proposal:", prop.proposal.summary);
const m1 = mark();
// 確認提案
await post(`/api/proposals/${prop.proposal.id}/confirm`, {}, cookie);
await waitForAfter(m1, (e: { type?: string }) => e.type === "proposal_resolved", "resolved");
await waitFor((e: { type?: string }) => e.type === "chat_done" || e.type === "chat_error", "turn1 done");
const doneEv = events.find((e) => e.type === "chat_done" || e.type === "chat_error") as never as {
  type: string;
  error?: string;
};
if (doneEv.type === "chat_error") throw new Error("turn1 error: " + doneEv.error);
console.log("turn 1 done; tool blocks:",
  events.filter((e: { type?: string; block?: { kind?: string } }) => e.type === "chat_block" && e.block?.kind === "tool_status").length);

// ---- 第 2 輪:agent 應該知道提案已被確認 ----
console.log("=== turn 2: 確認 agent 知道裁決結果 ===");
const m2 = mark();
await post(
  `/api/trips/${tripId}/chat`,
  { text: "我剛剛對你上一個提案做了什麼?一句話回答,不要使用任何工具。" },
  cookie,
);
const done2 = await waitForAfter<{ messageId: string }>(
  m2,
  (e: { type?: string }) => e.type === "chat_done",
  "turn2 done",
);
const msg2 = (await (
  await fetch(`${GW}/api/trips/${tripId}/chat?sinceSeq=0&limit=500`, { headers: { cookie } })
).json()) as { messages: Array<{ id: string; content: string }> };
const answer = msg2.messages.find((m) => m.id === done2.messageId)?.content ?? "";
console.log("agent 回答:", answer.slice(0, 120));
if (!/確認|套用|通過|同意/.test(answer)) console.log("WARN: 回答未明確提到確認/套用");

// ---- 第 3 輪:中途中止 ----
console.log("=== turn 3: 串流中止 ===");
const m3 = mark();
await post(
  `/api/trips/${tripId}/chat`,
  { text: "請不使用任何工具,直接詳細介紹東京 30 個景點,每個 100 字。" },
  cookie,
);
await waitForAfter(m3, (e: { type?: string }) => e.type === "chat_delta", "first delta", 120_000);
await post(`/api/trips/${tripId}/agent/stop`, {}, cookie);
const stopped = await waitForAfter<{ messageId: string }>(
  m3,
  (e: { type?: string }) => e.type === "chat_stopped",
  "chat_stopped",
  30_000,
);
console.log("stopped:", stopped.messageId);

// ---- 第 4 輪:中止後 resume 正常 ----
console.log("=== turn 4: 中止後繼續對話 ===");
const m4 = mark();
await post(
  `/api/trips/${tripId}/chat`,
  { text: "請只回覆兩個字:「OK」。不要使用工具。" },
  cookie,
);
await waitForAfter(m4, (e: { type?: string }) => e.type === "chat_done", "turn4 done");
console.log("turn 4 done");

// 行程確認:一蘭拉麵 上野店 已存在
const itin = (await (
  await fetch(`${GW}/api/trips/${tripId}/itinerary`, { headers: { cookie } })
).json()) as { stops: Array<{ name: string }>; trip: { itineraryRev: number } };
console.log("stops:", itin.stops.map((s) => s.name).join(","), "rev:", itin.trip.itineraryRev);
if (!itin.stops.some((s) => s.name.includes("一蘭"))) throw new Error("提案套用後找不到一蘭");

// 模型切回預設
await fetch(GW + "/api/admin/settings", {
  method: "PUT",
  headers: { "content-type": "application/json", cookie: adminCookie },
  body: JSON.stringify({ agent_model: "claude-opus-5" }),
});

ws.close();
console.log("AGENT SMOKE PASS");
process.exit(0);
