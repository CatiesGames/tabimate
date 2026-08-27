import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_MS,
  AVATAR_COLORS,
} from "../../shared/config";
import {
  checkAdminCredentials,
  createSession,
  destroySession,
  requireAdmin,
} from "../auth";
import { unlinkSync } from "node:fs";

import { db, newId, now } from "../db";
import {
  buildCookie,
  clearCookie,
  HttpError,
  json,
  parseCookies,
  readJson,
  route,
} from "../http";
import { getAllSettings, putSettings, SETTING_DEFAULTS } from "../settings";

/** 設定變更後通知(ws 模組在 M3 註冊,先留 hook)。 */
let onSettingsChanged: () => void = () => {};
export function setSettingsChangedHook(fn: () => void) {
  onSettingsChanged = fn;
}

export function registerAdminRoutes() {
  route("POST", "/api/admin/login", async (ctx) => {
    const body = await readJson<{ username?: string; password?: string }>(ctx.req);
    if (!checkAdminCredentials(body.username ?? "", body.password ?? "")) {
      throw new HttpError(401, "bad_credentials", "帳號或密碼不正確");
    }
    const token = createSession("admin", null);
    ctx.setCookies.push(buildCookie(ADMIN_COOKIE, token, ADMIN_SESSION_TTL_MS));
    return json({ ok: true });
  });

  route("POST", "/api/admin/logout", (ctx) => {
    const token = parseCookies(ctx.req)[ADMIN_COOKIE];
    if (token) destroySession(token);
    ctx.setCookies.push(clearCookie(ADMIN_COOKIE));
    return json({ ok: true });
  });

  route("GET", "/api/admin/me", (ctx) => {
    requireAdmin(ctx);
    return json({ ok: true });
  });

  // ---- 行程管理 ----

  route("GET", "/api/admin/trips", (ctx) => {
    requireAdmin(ctx);
    const rows = db
      .query(
        `SELECT t.*, (SELECT COUNT(*) FROM users u WHERE u.trip_id = t.id) AS user_count
         FROM trips t ORDER BY t.created_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    return json({
      trips: rows.map((r) => ({
        id: r.id,
        title: r.title,
        destination: r.destination,
        startDate: r.start_date,
        status: r.status,
        isHidden: !!r.is_hidden,
        itineraryRev: r.itinerary_rev,
        userCount: r.user_count,
        createdAt: r.created_at,
      })),
    });
  });

  route("POST", "/api/admin/trips", async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson<{
      title?: string;
      destination?: string;
      startDate?: string;
      /** 起訖換算的天數(1~60,省略=1):建立時直接鋪好 Day 1..N。 */
      days?: number;
    }>(ctx.req);
    if (!body.title?.trim()) throw new HttpError(400, "missing_title");
    if (body.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
      throw new HttpError(400, "bad_start_date");
    }
    const dayCount = Math.min(60, Math.max(1, Math.round(Number(body.days) || 1)));
    const id = newId();
    const t = now();
    db.run(
      "INSERT INTO trips (id, title, destination, start_date, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [id, body.title.trim(), body.destination?.trim() || null, body.startDate || null, t, t],
    );
    // 新行程直接鋪好天數,工作區一打開就能用。
    for (let i = 0; i < dayCount; i++) {
      db.run(
        "INSERT INTO days (id, trip_id, position, created_at, updated_at) VALUES (?,?,?,?,?)",
        [newId(), id, i, t, t],
      );
    }
    return json({ id });
  });

  route("PATCH", "/api/admin/trips/:tripId", async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson<Record<string, string> & { isHidden?: boolean }>(ctx.req);
    const trip = db.query("SELECT id FROM trips WHERE id = ?").get(ctx.params.tripId);
    if (!trip) throw new HttpError(404, "not_found");
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (typeof body.title === "string" && body.title.trim()) {
      sets.push("title = ?");
      vals.push(body.title.trim());
    }
    if ("destination" in body) {
      sets.push("destination = ?");
      vals.push(body.destination?.trim() || null);
    }
    if ("startDate" in body) {
      if (body.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
        throw new HttpError(400, "bad_start_date");
      }
      sets.push("start_date = ?");
      vals.push(body.startDate || null);
    }
    if (body.status && ["planning", "active", "archived"].includes(body.status)) {
      sets.push("status = ?");
      vals.push(body.status);
    }
    if (typeof body.isHidden === "boolean") {
      sets.push("is_hidden = ?");
      vals.push(body.isHidden ? 1 : 0);
    }
    if (sets.length) {
      sets.push("updated_at = ?");
      vals.push(now(), ctx.params.tripId);
      db.run(`UPDATE trips SET ${sets.join(", ")} WHERE id = ?`, vals as never);
    }
    return json({ ok: true });
  });

  route("DELETE", "/api/admin/trips/:tripId", (ctx) => {
    requireAdmin(ctx);
    db.run("DELETE FROM trips WHERE id = ?", [ctx.params.tripId]);
    return json({ ok: true });
  });

  // ---- 行程內使用者管理 ----

  route("GET", "/api/admin/trips/:tripId/users", (ctx) => {
    requireAdmin(ctx);
    const rows = db
      .query(
        "SELECT id, name, avatar_color, is_active, created_at FROM users WHERE trip_id = ? ORDER BY created_at",
      )
      .all(ctx.params.tripId) as Array<Record<string, unknown>>;
    return json({
      users: rows.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.avatar_color,
        isActive: !!r.is_active,
      })),
    });
  });

  route("POST", "/api/admin/trips/:tripId/users", async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson<{ name?: string; password?: string; color?: string }>(
      ctx.req,
    );
    if (!body.name?.trim() || !body.password) throw new HttpError(400, "missing_fields");
    const trip = db.query("SELECT id FROM trips WHERE id = ?").get(ctx.params.tripId);
    if (!trip) throw new HttpError(404, "trip_not_found");
    const color =
      body.color && /^#[0-9a-fA-F]{6}$/.test(body.color)
        ? body.color
        : AVATAR_COLORS[
            (db.query("SELECT COUNT(*) AS c FROM users WHERE trip_id = ?").get(ctx.params.tripId) as { c: number }).c %
              AVATAR_COLORS.length
          ];
    const id = newId();
    try {
      db.run(
        "INSERT INTO users (id, trip_id, name, avatar_color, password_hash, created_at) VALUES (?,?,?,?,?,?)",
        [
          id,
          ctx.params.tripId,
          body.name.trim(),
          color,
          await Bun.password.hash(body.password, { algorithm: "argon2id" }),
          now(),
        ],
      );
    } catch (e) {
      if (String(e).includes("UNIQUE")) throw new HttpError(409, "name_taken", "名稱已存在");
      throw e;
    }
    return json({ id });
  });

  route("PATCH", "/api/admin/users/:userId", async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson<{
      name?: string;
      password?: string;
      color?: string;
      isActive?: boolean;
    }>(ctx.req);
    const user = db.query("SELECT id FROM users WHERE id = ?").get(ctx.params.userId);
    if (!user) throw new HttpError(404, "not_found");
    if (body.name?.trim()) {
      db.run("UPDATE users SET name = ? WHERE id = ?", [body.name.trim(), ctx.params.userId]);
    }
    if (body.color && /^#[0-9a-fA-F]{6}$/.test(body.color)) {
      db.run("UPDATE users SET avatar_color = ? WHERE id = ?", [body.color, ctx.params.userId]);
    }
    if (typeof body.isActive === "boolean") {
      db.run("UPDATE users SET is_active = ? WHERE id = ?", [
        body.isActive ? 1 : 0,
        ctx.params.userId,
      ]);
    }
    if (body.password) {
      db.run("UPDATE users SET password_hash = ? WHERE id = ?", [
        await Bun.password.hash(body.password, { algorithm: "argon2id" }),
        ctx.params.userId,
      ]);
      // 改密碼時砍掉該使用者所有 session
      db.run("DELETE FROM sessions WHERE user_id = ?", [ctx.params.userId]);
    }
    return json({ ok: true });
  });

  route("DELETE", "/api/admin/users/:userId", (ctx) => {
    requireAdmin(ctx);
    db.run("DELETE FROM users WHERE id = ?", [ctx.params.userId]);
    return json({ ok: true });
  });

  // ---- 設定 ----

  route("GET", "/api/admin/settings", async (ctx) => {
    requireAdmin(ctx);
    const { usageSummary } = await import("../google");
    return json({
      settings: getAllSettings(),
      keys: Object.keys(SETTING_DEFAULTS),
      usage: usageSummary(),
    });
  });

  route("PUT", "/api/admin/settings", async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson<Record<string, string>>(ctx.req);
    putSettings(body);
    onSettingsChanged();
    return json({ settings: getAllSettings() });
  });

  // ---- Google 快取管理:統計 + 分類清除(清除後下次取用會重新向 Google 要,按用量計費)----
  const CACHE_KINDS: Record<
    string,
    { label: string; count: () => number; clear: () => number }
  > = {
    // 注意:照片與靜態地圖同存 g_photo_cache 且 place_id 都是 NULL,
    // 只能靠副檔名區分(staticMap 存 .png、placePhoto 存 .jpg)
    staticmap: {
      label: "PDF 靜態地圖",
      count: () =>
        (db.query("SELECT COUNT(*) c FROM g_photo_cache WHERE path LIKE '%.png'").get() as { c: number }).c,
      clear: () => clearPhotoRows("path LIKE '%.png'"),
    },
    photos: {
      label: "地點照片",
      count: () =>
        (db.query("SELECT COUNT(*) c FROM g_photo_cache WHERE path LIKE '%.jpg'").get() as { c: number }).c,
      clear: () => clearPhotoRows("path LIKE '%.jpg'"),
    },
    places: {
      label: "地點資料(營業時間等)",
      count: () => (db.query("SELECT COUNT(*) c FROM g_place_cache").get() as { c: number }).c,
      clear: () => {
        const n = (db.query("SELECT COUNT(*) c FROM g_place_cache").get() as { c: number }).c;
        db.run("DELETE FROM g_place_cache");
        return n;
      },
    },
    directions: {
      label: "路線查詢",
      count: () => (db.query("SELECT COUNT(*) c FROM g_directions_cache").get() as { c: number }).c,
      clear: () => {
        const n = (db.query("SELECT COUNT(*) c FROM g_directions_cache").get() as { c: number }).c;
        db.run("DELETE FROM g_directions_cache");
        return n;
      },
    },
    autocomplete: {
      label: "搜尋自動完成",
      count: () => (db.query("SELECT COUNT(*) c FROM g_autocomplete_cache").get() as { c: number }).c,
      clear: () => {
        const n = (db.query("SELECT COUNT(*) c FROM g_autocomplete_cache").get() as { c: number }).c;
        db.run("DELETE FROM g_autocomplete_cache");
        return n;
      },
    },
  };
  /** 刪 g_photo_cache 的列連同磁碟檔案。 */
  const clearPhotoRows = (where: string): number => {
    const rows = db.query(`SELECT key, path FROM g_photo_cache WHERE ${where}`).all() as Array<{
      key: string;
      path: string;
    }>;
    for (const r of rows) {
      try {
        unlinkSync(r.path);
      } catch {
        // 檔案已不存在就略過
      }
    }
    db.run(`DELETE FROM g_photo_cache WHERE ${where}`);
    return rows.length;
  };

  route("GET", "/api/admin/caches", (ctx) => {
    requireAdmin(ctx);
    return json({
      caches: Object.entries(CACHE_KINDS).map(([kind, c]) => ({
        kind,
        label: c.label,
        count: c.count(),
      })),
    });
  });

  route("POST", "/api/admin/caches/clear", async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson<{ kind?: string }>(ctx.req);
    const c = body.kind ? CACHE_KINDS[body.kind] : undefined;
    if (!c) throw new HttpError(400, "unknown_cache_kind");
    return json({ cleared: c.clear() });
  });
}
