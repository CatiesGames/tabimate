import { requireUser } from "../auth";
import {
  autocomplete,
  directions,
  googleConfigured,
  GoogleApiError,
  GoogleQuotaExhausted,
  GoogleUnconfigured,
  placeDetails,
  placePhoto,
  staticMap,
  type Waypoint,
} from "../google";
import { carryOverLodging, primaryLodgingOf } from "../../shared/conflicts";
import { db } from "../db";
import { loadDoc } from "../itinerary";
import { HttpError, json, route } from "../http";
import { getSetting } from "../settings";

function guard<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    if (e instanceof GoogleUnconfigured) {
      throw new HttpError(503, "google_unconfigured", "尚未設定 Google 地圖金鑰");
    }
    if (e instanceof GoogleQuotaExhausted) {
      throw new HttpError(
        503,
        "google_quota_exhausted",
        "本月 Google 呼叫額度已用完(保護免費額度),下個月自動恢復;可在後台調整上限",
      );
    }
    if (e instanceof GoogleApiError) {
      throw new HttpError(502, "google_api_error", e.message);
    }
    throw e;
  });
}

function withCache(data: Record<string, unknown>, cache: "HIT" | "MISS"): Response {
  return Response.json(data, { headers: { "X-Cache": cache } });
}

export function registerGoogleRoutes() {
  route("GET", "/api/google/status", (ctx) => {
    requireUser(ctx);
    return json({
      configured: googleConfigured(),
      mapsBrowserKey: getSetting("google_maps_browser_key") || null,
    });
  });

  route("GET", "/api/google/autocomplete", async (ctx) => {
    requireUser(ctx);
    const q = ctx.url.searchParams.get("q")?.trim();
    if (!q) throw new HttpError(400, "missing_query");
    const latStr = ctx.url.searchParams.get("lat");
    const lngStr = ctx.url.searchParams.get("lng");
    const near =
      latStr !== null && lngStr !== null && Number.isFinite(Number(latStr)) && Number.isFinite(Number(lngStr))
        ? { lat: Number(latStr), lng: Number(lngStr) }
        : undefined;
    const { results, cache } = await guard(() => autocomplete(q, near));
    return withCache({ results }, cache);
  });

  route("GET", "/api/google/place/:placeId", async (ctx) => {
    requireUser(ctx);
    const { place, cache } = await guard(() => placeDetails(ctx.params.placeId));
    return withCache({ place }, cache);
  });

  // photoRef 含斜線,走 query 參數
  route("GET", "/api/google/photo", async (ctx) => {
    requireUser(ctx);
    const ref = ctx.url.searchParams.get("ref");
    if (!ref || !/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(ref)) {
      throw new HttpError(400, "bad_photo_ref");
    }
    const w = Number(ctx.url.searchParams.get("w") ?? 400);
    const { path, cache } = await guard(() => placePhoto(ref, w));
    return new Response(Bun.file(path), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "private, max-age=2592000",
        "X-Cache": cache,
      },
    });
  });

  // PDF 每日地圖:該天所有有座標的地點,依順序編號+連線
  route("GET", "/api/google/staticmap", async (ctx) => {
    const { user } = requireUser(ctx);
    const dayId = ctx.url.searchParams.get("day") ?? "";
    const day = db.query("SELECT trip_id FROM days WHERE id = ?").get(dayId) as {
      trip_id: string;
    } | null;
    if (!day || day.trip_id !== user.trip_id) throw new HttpError(404, "day_not_found");
    // scope=main 時排除「不納入視野」的遠點(機場等),呈現主要活動區
    const scope = ctx.url.searchParams.get("scope") === "main" ? "main" : "all";
    const allRows = db
      .query("SELECT lat, lng, exclude_from_fit FROM stops WHERE day_id = ? ORDER BY position")
      .all(dayId) as Array<{ lat: number | null; lng: number | null; exclude_from_fit: number }>;
    // 編號 = 時間軸全列表序號(無座標的卡佔號但不畫),兩邊對得上
    const pts = allRows
      .map((r, i) => ({ lat: r.lat, lng: r.lng, n: i + 1, ex: !!r.exclude_from_fit }))
      .filter((r): r is { lat: number; lng: number; n: number; ex: boolean } => r.lat != null && r.lng != null)
      .filter((r) => scope === "all" || !r.ex);
    if (pts.length === 0) throw new HttpError(404, "no_located_stops");
    // 續住日把住宿也畫進地圖(起點/終點)
    const { doc } = loadDoc(day.trip_id);
    const carry = carryOverLodging(doc.days, doc.stops, dayId);
    // 入住日先放行李(過夜住宿不在末位):路徑結尾閉環回飯店(飯店已是編號 marker)
    const dayStops = doc.stops
      .filter((s2) => s2.dayId === dayId)
      .sort((a, b) => a.position - b.position);
    const ownLodging = primaryLodgingOf(doc.days, doc.stops, dayId);
    const midday =
      !carry && ownLodging && dayStops[dayStops.length - 1]?.id !== ownLodging.id
        ? ownLodging
        : null;
    const lodging =
      carry && carry.stop.lat != null && carry.stop.lng != null
        ? { lat: carry.stop.lat, lng: carry.stop.lng, returnAtNight: !carry.isCheckoutDay }
        : midday && midday.lat != null && midday.lng != null
          ? { lat: midday.lat, lng: midday.lng, returnAtNight: true, skipMarker: true }
          : undefined;
    const { path, cache, etag } = await guard(() => staticMap(pts, lodging));
    // ETag=內容雜湊:行程一改(加點/移動/座標變)圖就換;沒變則 304。
    // 不能用 max-age:URL 只有 day id,長快取會讓新增地點後 PDF 地圖不更新。
    const tag = `"${etag}"`;
    if (ctx.req.headers.get("if-none-match") === tag) {
      return new Response(null, {
        status: 304,
        headers: { etag: tag, "cache-control": "private, no-cache" },
      });
    }
    return new Response(Bun.file(path), {
      headers: {
        "content-type": "image/png",
        etag: tag,
        "cache-control": "private, no-cache",
        "X-Cache": cache,
      },
    });
  });

  route("GET", "/api/google/directions", async (ctx) => {
    requireUser(ctx);
    const p = ctx.url.searchParams;
    const parseWp = (prefix: string): Waypoint => {
      const placeId = p.get(`${prefix}PlaceId`);
      if (placeId) return { placeId };
      const latStr = p.get(`${prefix}Lat`);
      const lngStr = p.get(`${prefix}Lng`);
      if (latStr !== null && lngStr !== null) {
        const lat = Number(latStr);
        const lng = Number(lngStr);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
      }
      const address = p.get(`${prefix}Address`);
      if (address) return { address };
      throw new HttpError(400, `missing_${prefix}`);
    };
    const { alternatives, cache, note } = await guard(() =>
      directions({
        from: parseWp("from"),
        to: parseWp("to"),
        mode: p.get("mode") ?? "transit",
        departureTime: p.get("departure") ?? undefined,
      }),
    );
    return withCache({ alternatives, note }, cache);
  });
}
