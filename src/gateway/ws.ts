// WS hub:ticket 驗證 upgrade、topic pub/sub、presence(純記憶體)、bus 轉發。
import type { Server, ServerWebSocket } from "bun";

import { AGENT_USER_ID } from "../shared/config";
import { consumeWsTicket } from "./auth";
import { subscribe, type BusEvent } from "./bus";
import { db, newId } from "./db";
import { getSetting } from "./settings";

export type WsData = {
  connId: string;
  userId: string;
  tripId: string;
  subscribed: boolean;
  viewing: { dayId?: string; stopId?: string } | null;
};

type Conn = ServerWebSocket<WsData>;

let server: Server<WsData> | null = null;
const conns = new Map<string, Conn>();

// agent 偽成員 focus(M5 的 runner/MCP 會呼叫 setAgentFocus)。
const agentFocus = new Map<string, { viewing: { dayId?: string; stopId?: string } | null }>();

export function setServer(s: Server<WsData>) {
  server = s;
}

export function topicOf(tripId: string): string {
  return `trip:${tripId}`;
}

export function broadcast(tripId: string, event: Record<string, unknown>) {
  server?.publish(topicOf(tripId), JSON.stringify(event));
}

/** 成功 upgrade 時回 undefined(Bun 約定);其餘回錯誤 Response。 */
export function tryUpgradeWs(req: Request, srv: Server<WsData>): Response | undefined {
  const url = new URL(req.url);
  const ticket = consumeWsTicket(url.searchParams.get("token") ?? "");
  if (!ticket) return Response.json({ error: "bad_ticket" }, { status: 401 });
  const ok = srv.upgrade(req, {
    data: {
      connId: newId(),
      userId: ticket.userId,
      tripId: ticket.tripId,
      subscribed: false,
      viewing: null,
    } satisfies WsData,
  });
  return ok ? undefined : Response.json({ error: "upgrade_failed" }, { status: 400 });
}

function rosterOf(tripId: string) {
  // 依 userId 合併(同人多分頁),取最近的 viewing。
  const byUser = new Map<string, { userId: string; viewing: WsData["viewing"] }>();
  for (const c of conns.values()) {
    if (c.data.tripId !== tripId) continue;
    const prev = byUser.get(c.data.userId);
    byUser.set(c.data.userId, {
      userId: c.data.userId,
      viewing: c.data.viewing ?? prev?.viewing ?? null,
    });
  }
  const roster = [...byUser.values()].map((u) => ({ ...u, online: true }));
  const agent = agentFocus.get(tripId);
  if (agent) {
    roster.push({ userId: AGENT_USER_ID, viewing: agent.viewing, online: true });
  }
  return roster;
}

function pushRoster(tripId: string) {
  broadcast(tripId, { type: "presence", roster: rosterOf(tripId) });
}

/** M5:agent 開始工作/切換焦點/結束時呼叫。null = agent 下線。 */
export function setAgentFocus(
  tripId: string,
  viewing: { dayId?: string; stopId?: string } | null,
  active: boolean,
) {
  if (active) agentFocus.set(tripId, { viewing });
  else agentFocus.delete(tripId);
  pushRoster(tripId);
}

/** M5 會覆寫:sub_ok 的 agent/串流補齊狀態。 */
let agentStateProvider: (tripId: string) => Record<string, unknown> = () => ({
  available: false,
  model: getSetting("agent_model"),
  queue: [],
  activeStream: null,
});
export function setAgentStateProvider(fn: (tripId: string) => Record<string, unknown>) {
  agentStateProvider = fn;
}

function buildSubOk(tripId: string) {
  const trip = db
    .query("SELECT itinerary_rev FROM trips WHERE id = ?")
    .get(tripId) as { itinerary_rev: number } | null;
  const latestSeq = (
    db
      .query("SELECT COALESCE(MAX(seq), 0) AS s FROM chat_messages WHERE trip_id = ?")
      .get(tripId) as { s: number }
  ).s;
  const pending = db
    .query(
      "SELECT id, summary, changeset, base_rev, requested_by_user_id, chat_message_id, created_at FROM proposals WHERE trip_id = ? AND status = 'pending' ORDER BY created_at",
    )
    .all(tripId) as Array<Record<string, unknown>>;
  return {
    type: "sub_ok",
    itineraryRev: trip?.itinerary_rev ?? 0,
    latestChatSeq: latestSeq,
    pendingProposals: pending.map((p) => ({
      id: p.id,
      summary: p.summary,
      operations: JSON.parse(p.changeset as string),
      baseRev: p.base_rev,
      requestedByUserId: p.requested_by_user_id,
      chatMessageId: p.chat_message_id,
      createdAt: p.created_at,
      status: "pending",
    })),
    presenceRoster: rosterOf(tripId),
    agent: agentStateProvider(tripId),
    googleReady: getSetting("google_maps_api_key") !== "",
    mapsBrowserKey: getSetting("google_maps_browser_key") || null,
  };
}

export const wsHandlers = {
  open(ws: Conn) {
    conns.set(ws.data.connId, ws);
  },
  message(ws: Conn, raw: string | Buffer) {
    let msg: { type?: string } & Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (msg.type) {
      case "sub": {
        // ticket 已綁定 tripId,只允許訂自己的行程
        ws.subscribe(topicOf(ws.data.tripId));
        ws.subscribe("global");
        ws.data.subscribed = true;
        ws.send(JSON.stringify(buildSubOk(ws.data.tripId)));
        pushRoster(ws.data.tripId);
        break;
      }
      case "presence": {
        const viewing = msg.viewing as WsData["viewing"];
        ws.data.viewing =
          viewing && typeof viewing === "object"
            ? {
                dayId: typeof viewing.dayId === "string" ? viewing.dayId : undefined,
                stopId: typeof viewing.stopId === "string" ? viewing.stopId : undefined,
              }
            : null;
        pushRoster(ws.data.tripId);
        break;
      }
      case "ping":
        ws.send('{"type":"pong"}');
        break;
    }
  },
  close(ws: Conn) {
    conns.delete(ws.data.connId);
    pushRoster(ws.data.tripId);
  },
};

/** bus → WS 廣播。gateway 啟動時呼叫一次。 */
export function initWsBridge() {
  subscribe((tripId: string, event: BusEvent) => {
    if (tripId === "*") server?.publish("global", JSON.stringify(event));
    else broadcast(tripId, event);
  });
}
