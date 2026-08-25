// M4 冒煙:手鑄 job token 直打 /mcp propose_changes → WS 收到 proposal_new →
// REST confirm → 版本產生;再測衝突路徑(提案引用已刪除的 stop → failed_conflict)。
const GW = "http://127.0.0.1:4681";

async function post(path: string, body: unknown, cookie?: string, bearer?: string) {
  const res = await fetch(GW + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as never };
}

// 登入
const trips = (await (await fetch(`${GW}/api/auth/trips`)).json()) as {
  trips: Array<{ id: string }>;
};
const tripId = trips.trips[0].id;
const users = (await (await fetch(`${GW}/api/auth/trips/${tripId}/users`)).json()) as {
  users: Array<{ id: string }>;
};
const userId = users.users[0].id;
const loginRes = await fetch(`${GW}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ userId, password: "pw1234" }),
});
const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];

// 開 WS 收事件
const t = (await (
  await fetch(`${GW}/api/auth/ws-ticket`, { headers: { cookie } })
).json()) as { ticket: string };
const ws = new WebSocket(`ws://127.0.0.1:4681/ws?token=${t.ticket}`);
const events: Array<{ type?: string } & Record<string, unknown>> = [];
ws.onmessage = (ev) => events.push(JSON.parse(String(ev.data)));
await new Promise<void>((r) => (ws.onopen = () => r()));
ws.send('{"type":"sub"}');

function waitFor<T>(pred: (e: never) => boolean, label: string, ms = 4000): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const hit = events.find((e) => pred(e as never));
      if (hit) (clearInterval(timer), resolve(hit as T));
      else if (Date.now() - start > ms)
        (clearInterval(timer), reject(new Error("timeout: " + label)));
    }, 40);
  });
}

// 手鑄 job token
const { data: mint } = await post("/api/dev/mint-job-token", { tripId, userId });
const jobToken = (mint as { token: string }).token;

// MCP tools/list
const { data: list } = await post(
  "/mcp",
  { jsonrpc: "2.0", id: 1, method: "tools/list" },
  undefined,
  jobToken,
);
const toolNames = (list as { result: { tools: Array<{ name: string }> } }).result.tools.map(
  (x) => x.name,
);
console.log("tools:", toolNames.join(","));
if (!toolNames.includes("propose_changes")) throw new Error("missing propose_changes");

// MCP get_itinerary
const { data: itinRaw } = await post(
  "/mcp",
  { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_itinerary", arguments: {} } },
  undefined,
  jobToken,
);
const itin = JSON.parse(
  (itinRaw as { result: { content: Array<{ text: string }> } }).result.content[0].text,
) as { days: Array<{ id: string }>; stops: Array<{ id: string; name: string }>; itineraryRev: number };
console.log("itinerary rev:", itin.itineraryRev, "stops:", itin.stops.map((s) => s.name).join(","));

// MCP propose_changes
const { data: propRaw } = await post(
  "/mcp",
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "propose_changes",
      arguments: {
        summary: "第一天傍晚加東京鐵塔",
        operations: [
          {
            op: "add_stop",
            dayId: itin.days[0].id,
            name: "東京鐵塔",
            category: "sight",
            startTime: "17:30",
            bookingType: "ticket_required",
          },
        ],
      },
    },
  },
  undefined,
  jobToken,
);
const propResult = JSON.parse(
  (propRaw as { result: { content: Array<{ text: string }> } }).result.content[0].text,
) as { proposalId: string; status: string };
console.log("propose:", propResult.status, propResult.proposalId);

const propEvent = await waitFor<{ proposal: { id: string } }>(
  (e: { type?: string }) => e.type === "proposal_new",
  "proposal_new",
);
if (propEvent.proposal.id !== propResult.proposalId) throw new Error("proposal id mismatch");

// REST confirm → applied + itin_changed + proposal_resolved
const { data: confirm } = await post(
  `/api/proposals/${propResult.proposalId}/confirm`,
  {},
  cookie,
);
console.log("confirm status:", (confirm as { proposal: { status: string } }).proposal.status);
await waitFor((e: { type?: string }) => e.type === "proposal_resolved", "proposal_resolved");
await waitFor(
  (e: { type?: string; actor?: { viaAgent?: boolean } }) =>
    e.type === "itin_changed" && e.actor?.viaAgent === true,
  "itin_changed viaAgent",
);

// 重複 confirm → 靜默收斂
const { data: again } = await post(
  `/api/proposals/${propResult.proposalId}/confirm`,
  {},
  cookie,
);
if (!(again as { alreadyResolved?: boolean }).alreadyResolved) {
  throw new Error("expected alreadyResolved");
}
console.log("double-confirm converges: ok");

// 衝突路徑:提案引用一個 stop,確認前先把它刪掉 → failed_conflict
// (用剛加入的 東京鐵塔;找不到就用任一 stop)
const itinNow = JSON.parse(
  (
    (await post(
      "/mcp",
      { jsonrpc: "2.0", id: 40, method: "tools/call", params: { name: "get_itinerary", arguments: {} } },
      undefined,
      jobToken,
    )).data as { result: { content: Array<{ text: string }> } }
  ).result.content[0].text,
) as { stops: Array<{ id: string; name: string }> };
const target = itinNow.stops.find((s) => s.name === "東京鐵塔") ?? itinNow.stops[0];
if (!target) throw new Error("行程中沒有任何地點可測衝突路徑");
const { data: prop2Raw } = await post(
  "/mcp",
  {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "propose_changes",
      arguments: {
        summary: "改淺草寺時間",
        operations: [{ op: "update_stop", stopId: target.id, patch: { startTime: "08:00" } }],
      },
    },
  },
  undefined,
  jobToken,
);
const prop2 = JSON.parse(
  (prop2Raw as { result: { content: Array<{ text: string }> } }).result.content[0].text,
) as { proposalId: string };
await post(
  `/api/trips/${tripId}/edit`,
  { ops: [{ op: "remove_stop", stopId: target.id }] },
  cookie,
);
const { data: confirm2 } = await post(`/api/proposals/${prop2.proposalId}/confirm`, {}, cookie);
const status2 = (confirm2 as { proposal: { status: string } }).proposal.status;
console.log("conflict path:", status2);
if (status2 !== "failed_conflict") throw new Error("expected failed_conflict");

// 無效 token
const bad = await post("/mcp", { jsonrpc: "2.0", id: 9, method: "tools/list" }, undefined, "nope");
if (bad.status !== 401) throw new Error("expected 401 for bad token");

ws.close();
console.log("PROPOSAL SMOKE PASS");
process.exit(0);
