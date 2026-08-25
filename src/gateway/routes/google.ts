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
  type Waypoint,
} from "../google";
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
