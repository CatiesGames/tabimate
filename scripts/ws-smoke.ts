// WS 冒煙測試:sub_ok → 編輯後收到 itin_changed → presence 進出。
// 需要 gateway 在跑、DB 內已有 M1 建立的行程與使用者(pw1234)。
const GW = "http://127.0.0.1:4681";

async function login(): Promise<{ cookie: string; tripId: string; userId: string }> {
  const trips = (await (await fetch(`${GW}/api/auth/trips`)).json()) as {
    trips: Array<{ id: string }>;
  };
  const tripId = trips.trips[0].id;
  const users = (await (await fetch(`${GW}/api/auth/trips/${tripId}/users`)).json()) as {
    users: Array<{ id: string }>;
  };
  const userId = users.users[0].id;
  const res = await fetch(`${GW}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, password: "pw1234" }),
  });
  if (!res.ok) throw new Error("login failed");
  const cookie = res.headers.get("set-cookie")!.split(";")[0];
  return { cookie, tripId, userId };
}

async function openWs(cookie: string): Promise<{ ws: WebSocket; events: unknown[] }> {
  const t = (await (
    await fetch(`${GW}/api/auth/ws-ticket`, { headers: { cookie } })
  ).json()) as { ticket: string };
  const ws = new WebSocket(`ws://127.0.0.1:4681/ws?token=${t.ticket}`);
  const events: unknown[] = [];
  ws.onmessage = (ev) => events.push(JSON.parse(String(ev.data)));
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("ws error"));
  });
  ws.send(JSON.stringify({ type: "sub" }));
  return { ws, events };
}

function waitFor<T>(events: unknown[], pred: (e: never) => boolean, label: string, ms = 4000): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const hit = events.find((e) => pred(e as never));
      if (hit) {
        clearInterval(timer);
        resolve(hit as T);
      } else if (Date.now() - start > ms) {
        clearInterval(timer);
        reject(new Error(`timeout waiting: ${label}`));
      }
    }, 40);
  });
}

const { cookie, tripId } = await login();
const a = await openWs(cookie);

const subOk = await waitFor<{ itineraryRev: number; presenceRoster: unknown[] }>(
  a.events,
  (e: { type?: string }) => e.type === "sub_ok",
  "sub_ok",
);
console.log("sub_ok rev:", subOk.itineraryRev, "roster:", subOk.presenceRoster.length);

// 第二條連線 → 雙方都該看到 roster 更新
const b = await openWs(cookie);
await waitFor(b.events, (e: { type?: string }) => e.type === "sub_ok", "b sub_ok");

// 編輯 → itin_changed
const dayRes = (await (
  await fetch(`${GW}/api/trips/${tripId}/itinerary`, { headers: { cookie } })
).json()) as { days: Array<{ id: string }>; trip: { itineraryRev: number } };
const editRes = await fetch(`${GW}/api/trips/${tripId}/edit`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({
    ops: [{ op: "add_stop", dayId: dayRes.days[0].id, name: "WS測試點", category: "cafe" }],
  }),
});
if (!editRes.ok) throw new Error("edit failed: " + (await editRes.text()));

const changed = await waitFor<{ rev: number; summary: string; actor: { userId: string } }>(
  a.events,
  (e: { type?: string }) => e.type === "itin_changed",
  "itin_changed on A",
);
await waitFor(b.events, (e: { type?: string }) => e.type === "itin_changed", "itin_changed on B");
console.log("itin_changed rev:", changed.rev, "summary:", changed.summary);

// presence viewing 更新
a.ws.send(JSON.stringify({ type: "presence", viewing: { dayId: dayRes.days[0].id } }));
await waitFor(
  b.events,
  (e: { type?: string; roster?: Array<{ viewing?: { dayId?: string } }> }) =>
    e.type === "presence" && !!e.roster?.some((r) => r.viewing?.dayId === dayRes.days[0].id),
  "presence viewing on B",
);
console.log("presence viewing propagated");

// A 關閉 → B 的 roster 更新(單一使用者兩連線,關一條人還在;再關 B 前先驗 roster 事件有來)
a.ws.close();
await waitFor(b.events, (e: { type?: string }) => e.type === "presence", "presence after close");

// 清掉測試點
const itin = (await (
  await fetch(`${GW}/api/trips/${tripId}/itinerary`, { headers: { cookie } })
).json()) as { stops: Array<{ id: string; name: string }> };
const testStop = itin.stops.find((s) => s.name === "WS測試點");
if (testStop) {
  await fetch(`${GW}/api/trips/${tripId}/edit`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ ops: [{ op: "remove_stop", stopId: testStop.id }] }),
  });
}
b.ws.close();
console.log("WS SMOKE PASS");
process.exit(0);
