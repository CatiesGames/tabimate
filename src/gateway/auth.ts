import { createHash, timingSafeEqual } from "node:crypto";

import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_MS,
  SESSION_COOKIE,
  SESSION_REFRESH_MIN_MS,
  SESSION_TTL_MS,
  WS_TICKET_TTL_MS,
} from "../shared/config";
import { db, newId, now } from "./db";
import { buildCookie, HttpError, parseCookies, type Ctx } from "./http";

export type SessionRow = {
  id: string;
  user_id: string | null;
  kind: "user" | "admin";
  created_at: number;
  expires_at: number;
  last_seen_at: number;
};

export type UserRow = {
  id: string;
  trip_id: string;
  name: string;
  avatar_color: string;
  is_active: number;
};

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function createSession(kind: "user" | "admin", userId: string | null): string {
  const token = newToken();
  const t = now();
  const ttl = kind === "admin" ? ADMIN_SESSION_TTL_MS : SESSION_TTL_MS;
  db.run(
    "INSERT INTO sessions (id, user_id, kind, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)",
    [sha256hex(token), userId, kind, t, t + ttl, t],
  );
  return token;
}

export function destroySession(token: string) {
  db.run("DELETE FROM sessions WHERE id = ?", [sha256hex(token)]);
}

function loadSession(token: string | undefined, kind: "user" | "admin"): SessionRow | null {
  if (!token) return null;
  const row = db
    .query("SELECT * FROM sessions WHERE id = ? AND kind = ?")
    .get(sha256hex(token), kind) as SessionRow | null;
  if (!row) return null;
  if (row.expires_at < now()) {
    db.run("DELETE FROM sessions WHERE id = ?", [row.id]);
    return null;
  }
  return row;
}

/** 7 天滑動過期:任何已認證請求都展延;距上次刷新超過 1 小時才寫 DB + 重發 cookie。 */
function slideSession(ctx: Ctx, row: SessionRow, token: string) {
  const t = now();
  if (t - row.last_seen_at < SESSION_REFRESH_MIN_MS) return;
  db.run("UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?", [
    t + SESSION_TTL_MS,
    t,
    row.id,
  ]);
  ctx.setCookies.push(buildCookie(SESSION_COOKIE, token, SESSION_TTL_MS));
}

export function requireUser(ctx: Ctx): { session: SessionRow; user: UserRow } {
  const token = parseCookies(ctx.req)[SESSION_COOKIE];
  const session = loadSession(token, "user");
  if (!session || !session.user_id) throw new HttpError(401, "unauthorized");
  const user = db
    .query("SELECT * FROM users WHERE id = ? AND is_active = 1")
    .get(session.user_id) as UserRow | null;
  if (!user) throw new HttpError(401, "unauthorized");
  slideSession(ctx, session, token!);
  return { session, user };
}

export function requireTripUser(ctx: Ctx, tripId: string): UserRow {
  const { user } = requireUser(ctx);
  if (user.trip_id !== tripId) throw new HttpError(403, "forbidden");
  return user;
}

export function requireAdmin(ctx: Ctx): SessionRow {
  const token = parseCookies(ctx.req)[ADMIN_COOKIE];
  const session = loadSession(token, "admin");
  if (!session) throw new HttpError(401, "unauthorized");
  return session;
}

export function checkAdminCredentials(username: string, password: string): boolean {
  const envUser = process.env.ADMIN_USERNAME ?? "";
  const envPass = process.env.ADMIN_PASSWORD ?? "";
  if (!envUser || !envPass) return false;
  return ctEqual(username, envUser) && ctEqual(password, envPass);
}

function ctEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// ---- WS tickets:單次使用、60s TTL、純記憶體 ----

type Ticket = { userId: string; tripId: string; expiresAt: number };
const tickets = new Map<string, Ticket>();

export function mintWsTicket(userId: string, tripId: string): string {
  const token = newId(24);
  tickets.set(token, { userId, tripId, expiresAt: now() + WS_TICKET_TTL_MS });
  return token;
}

export function consumeWsTicket(token: string): Ticket | null {
  const t = tickets.get(token);
  if (!t) return null;
  tickets.delete(token);
  if (t.expiresAt < now()) return null;
  return t;
}

setInterval(() => {
  const t = now();
  for (const [k, v] of tickets) if (v.expiresAt < t) tickets.delete(k);
}, 30_000).unref?.();
