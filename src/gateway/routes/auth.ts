import { SESSION_COOKIE, SESSION_TTL_MS } from "../../shared/config";
import {
  createSession,
  destroySession,
  mintWsTicket,
  requireUser,
  type UserRow,
} from "../auth";
import { db } from "../db";
import {
  buildCookie,
  clearCookie,
  HttpError,
  json,
  parseCookies,
  readJson,
  route,
} from "../http";

function publicUser(u: UserRow) {
  return { id: u.id, tripId: u.trip_id, name: u.name, color: u.avatar_color };
}

export function registerAuthRoutes() {
  const TRIP_CARD_SQL = `SELECT t.id, t.title, t.destination, t.start_date, t.status,
                (SELECT COUNT(*) FROM users u WHERE u.trip_id = t.id AND u.is_active = 1) AS user_count,
                (SELECT COUNT(*) FROM days d WHERE d.trip_id = t.id) AS day_count
         FROM trips t`;
  const toTripCard = (r: Record<string, unknown>) => ({
    id: r.id,
    title: r.title,
    destination: r.destination,
    startDate: r.start_date,
    status: r.status,
    userCount: r.user_count,
    dayCount: r.day_count,
  });

  // 登入第一步:行程列表(未登入可見 — 信任 LAN;隱藏中的行程不列出)。
  route("GET", "/api/auth/trips", () => {
    const rows = db
      .query(`${TRIP_CARD_SQL} WHERE t.status != 'archived' AND t.is_hidden = 0 ORDER BY t.created_at DESC`)
      .all() as Array<Record<string, unknown>>;
    return json({ trips: rows.map(toTripCard) });
  });

  // 單一行程卡(直達連結用:隱藏中的行程也查得到,只擋封存)。
  route("GET", "/api/auth/trips/:tripId", (ctx) => {
    const row = db
      .query(`${TRIP_CARD_SQL} WHERE t.id = ? AND t.status != 'archived'`)
      .get(ctx.params.tripId) as Record<string, unknown> | null;
    if (!row) throw new HttpError(404, "trip_not_found");
    return json({ trip: toTripCard(row) });
  });

  // 登入第二步:該行程的使用者頭像格。
  route("GET", "/api/auth/trips/:tripId/users", (ctx) => {
    const rows = db
      .query(
        "SELECT id, trip_id, name, avatar_color, is_active FROM users WHERE trip_id = ? AND is_active = 1 ORDER BY created_at",
      )
      .all(ctx.params.tripId) as UserRow[];
    return json({ users: rows.map(publicUser) });
  });

  // 登入第三步:密碼。
  route("POST", "/api/auth/login", async (ctx) => {
    const body = await readJson<{ userId?: string; password?: string }>(ctx.req);
    if (!body.userId || typeof body.password !== "string") {
      throw new HttpError(400, "missing_fields");
    }
    const user = db
      .query("SELECT * FROM users WHERE id = ? AND is_active = 1")
      .get(body.userId) as (UserRow & { password_hash: string }) | null;
    if (!user || !(await Bun.password.verify(body.password, user.password_hash))) {
      throw new HttpError(401, "bad_credentials", "密碼不正確");
    }
    const token = createSession("user", user.id);
    ctx.setCookies.push(buildCookie(SESSION_COOKIE, token, SESSION_TTL_MS));
    return json({ user: publicUser(user) });
  });

  route("POST", "/api/auth/logout", (ctx) => {
    const token = parseCookies(ctx.req)[SESSION_COOKIE];
    if (token) destroySession(token);
    ctx.setCookies.push(clearCookie(SESSION_COOKIE));
    return json({ ok: true });
  });

  route("GET", "/api/auth/me", (ctx) => {
    const { user } = requireUser(ctx);
    const trip = db.query("SELECT * FROM trips WHERE id = ?").get(user.trip_id) as Record<
      string,
      unknown
    > | null;
    return json({
      user: publicUser(user),
      trip: trip && {
        id: trip.id,
        title: trip.title,
        destination: trip.destination,
        startDate: trip.start_date,
        status: trip.status,
        itineraryRev: trip.itinerary_rev,
      },
    });
  });

  route("GET", "/api/auth/ws-ticket", (ctx) => {
    const { user } = requireUser(ctx);
    return json({ ticket: mintWsTicket(user.id, user.trip_id) });
  });
}
