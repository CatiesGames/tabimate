// Google Maps Platform 代理 + SQLite 快取(控費 + ToS:只有 place_id 永久快取,其餘短 TTL)。
// 無 key 時所有函式丟 GoogleUnconfigured,route 層轉 503,agent 工具轉降級訊息。
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { db, now } from "./db";
import { getSetting } from "./settings";

export class GoogleUnconfigured extends Error {
  constructor() {
    super("google_unconfigured");
  }
}

export class GoogleQuotaExhausted extends Error {
  constructor(public kind: UsageKind) {
    super("google_quota_exhausted");
  }
}

// ---- 用量計數(app 端「月」上限,對齊 Google 的月度免費額度)----
// 只計「真的打到 Google」的呼叫;快取命中不計。逐日存列(後台可看今日/本月),上限按月加總判斷。

export type UsageKind = "autocomplete" | "place_details" | "photos" | "routes";

const LIMIT_KEY: Record<UsageKind, string> = {
  autocomplete: "limit_autocomplete_monthly",
  place_details: "limit_place_details_monthly",
  photos: "limit_photos_monthly",
  routes: "limit_routes_monthly",
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthPrefix(): string {
  return today().slice(0, 7); // YYYY-MM
}

function monthUsed(kind: UsageKind): number {
  const row = db
    .query("SELECT COALESCE(SUM(count), 0) AS s FROM g_usage WHERE date LIKE ? AND kind = ?")
    .get(`${monthPrefix()}-%`, kind) as { s: number };
  return row.s;
}

export function usageSummary(): Record<
  UsageKind,
  { monthUsed: number; todayUsed: number; limit: number }
> {
  const todayRows = db
    .query("SELECT kind, count FROM g_usage WHERE date = ?")
    .all(today()) as Array<{ kind: string; count: number }>;
  const todayMap = new Map(todayRows.map((r) => [r.kind, r.count]));
  const out = {} as ReturnType<typeof usageSummary>;
  for (const kind of Object.keys(LIMIT_KEY) as UsageKind[]) {
    out[kind] = {
      monthUsed: monthUsed(kind),
      todayUsed: todayMap.get(kind) ?? 0,
      limit: Number(getSetting(LIMIT_KEY[kind])) || 0,
    };
  }
  return out;
}

/** 呼叫 Google 前先過這關:本月累計達上限就丟 GoogleQuotaExhausted(0 = 不限)。 */
function chargeUsage(kind: UsageKind) {
  const limit = Number(getSetting(LIMIT_KEY[kind])) || 0;
  if (limit > 0 && monthUsed(kind) >= limit) throw new GoogleQuotaExhausted(kind);
  db.run(
    "INSERT INTO g_usage (date, kind, count) VALUES (?,?,1) ON CONFLICT(date, kind) DO UPDATE SET count = count + 1",
    [today(), kind],
  );
}

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const PHOTO_DIR = resolve("./data/gphotos");

function key(): string {
  const k = getSetting("google_maps_api_key");
  if (!k) throw new GoogleUnconfigured();
  return k;
}

export function googleConfigured(): boolean {
  return getSetting("google_maps_api_key") !== "";
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function ttlMs(settingKey: string, unit: "days" | "hours", fallback: number): number {
  const v = Number(getSetting(settingKey)) || fallback;
  return unit === "days" ? v * 86_400_000 : v * 3_600_000;
}

type CacheHit = { payload: string } | null;

function cacheGet(table: string, keyCol: string, keyVal: string): CacheHit {
  const row = db
    .query(`SELECT payload, expires_at FROM ${table} WHERE ${keyCol} = ?`)
    .get(keyVal) as { payload: string; expires_at: number } | null;
  if (!row) return null;
  if (row.expires_at < now()) {
    db.run(`DELETE FROM ${table} WHERE ${keyCol} = ?`, [keyVal]);
    return null;
  }
  return { payload: row.payload };
}

async function gFetch(url: string, init: RequestInit, fieldMask?: string): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": key(),
      ...(fieldMask ? { "X-Goog-FieldMask": fieldMask } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[google] ${res.status} ${url.split("?")[0]}: ${body.slice(0, 300)}`);
    throw new GoogleApiError(res.status, `Google API ${res.status}`);
  }
  return res.json();
}

// ---- Places Autocomplete (New) ----

export type AutocompleteResult = {
  placeId: string;
  mainText: string;
  secondaryText: string;
  types: string[];
};

export async function autocomplete(
  query: string,
  near?: { lat: number; lng: number },
): Promise<{ results: AutocompleteResult[]; cache: "HIT" | "MISS" }> {
  const normalized = query.trim().toLowerCase();
  const k = hash(`ac|${normalized}|${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ""}|zh-TW`);
  const hit = cacheGet("g_autocomplete_cache", "key", k);
  if (hit) return { results: JSON.parse(hit.payload), cache: "HIT" };

  chargeUsage("autocomplete");
  const body: Record<string, unknown> = {
    input: query,
    languageCode: "zh-TW",
  };
  if (near) {
    body.locationBias = {
      circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50_000 },
    };
  }
  const data = (await gFetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    body: JSON.stringify(body),
  })) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId: string;
        text?: { text: string };
        structuredFormat?: {
          mainText?: { text: string };
          secondaryText?: { text: string };
        };
        types?: string[];
      };
    }>;
  };
  const results: AutocompleteResult[] = (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({
      placeId: p.placeId,
      mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
      types: p.types ?? [],
    }));
  db.run(
    "INSERT OR REPLACE INTO g_autocomplete_cache (key, query, payload, fetched_at, expires_at) VALUES (?,?,?,?,?)",
    [k, normalized, JSON.stringify(results), now(), now() + ttlMs("cache_ttl_autocomplete_days", "days", 30)],
  );
  return { results, cache: "MISS" };
}

// ---- Place Details (New) ----

const PLACE_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "regularOpeningHours",
  "photos",
  "websiteUri",
  "nationalPhoneNumber",
  "googleMapsUri",
  "types",
].join(",");

export type PlaceDetails = {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
  userRatingCount?: number;
  openingHours?: string[];
  openNow?: boolean;
  photoRefs: string[];
  website?: string;
  phone?: string;
  googleMapsUri?: string;
  types: string[];
};

export async function placeDetails(
  placeId: string,
): Promise<{ place: PlaceDetails; cache: "HIT" | "MISS" }> {
  const hit = cacheGet("g_place_cache", "place_id", placeId);
  if (hit) return { place: JSON.parse(hit.payload), cache: "HIT" };

  chargeUsage("place_details");
  const d = (await gFetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=zh-TW`,
    { method: "GET" },
    PLACE_FIELD_MASK,
  )) as {
    id: string;
    displayName?: { text: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    rating?: number;
    userRatingCount?: number;
    regularOpeningHours?: { weekdayDescriptions?: string[]; openNow?: boolean };
    photos?: Array<{ name: string }>;
    websiteUri?: string;
    nationalPhoneNumber?: string;
    googleMapsUri?: string;
    types?: string[];
  };
  const place: PlaceDetails = {
    placeId: d.id,
    name: d.displayName?.text ?? "",
    address: d.formattedAddress ?? "",
    lat: d.location?.latitude ?? 0,
    lng: d.location?.longitude ?? 0,
    rating: d.rating,
    userRatingCount: d.userRatingCount,
    openingHours: d.regularOpeningHours?.weekdayDescriptions,
    openNow: d.regularOpeningHours?.openNow,
    photoRefs: (d.photos ?? []).slice(0, 10).map((p) => p.name),
    website: d.websiteUri,
    phone: d.nationalPhoneNumber,
    googleMapsUri: d.googleMapsUri,
    types: d.types ?? [],
  };
  db.run(
    "INSERT OR REPLACE INTO g_place_cache (place_id, payload, fetched_at, expires_at) VALUES (?,?,?,?)",
    [placeId, JSON.stringify(place), now(), now() + ttlMs("cache_ttl_place_details_days", "days", 7)],
  );
  return { place, cache: "MISS" };
}

// ---- Place Photo(磁碟快取二進位)----

export async function placePhoto(
  photoRef: string,
  maxWidth: number,
): Promise<{ path: string; cache: "HIT" | "MISS" }> {
  const w = Math.min(Math.max(maxWidth || 400, 100), 1600);
  const k = hash(`photo|${photoRef}|${w}`);
  const row = db
    .query("SELECT path, expires_at FROM g_photo_cache WHERE key = ?")
    .get(k) as { path: string; expires_at: number } | null;
  if (row && row.expires_at > now() && (await Bun.file(row.path).exists())) {
    return { path: row.path, cache: "HIT" };
  }

  chargeUsage("photos");
  const url = `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=${w}&key=${key()}`;
  const res = await fetch(url);
  if (!res.ok) throw new GoogleApiError(res.status, "photo fetch failed");
  mkdirSync(PHOTO_DIR, { recursive: true });
  const path = join(PHOTO_DIR, `${k}.jpg`);
  await Bun.write(path, await res.arrayBuffer());
  db.run(
    "INSERT OR REPLACE INTO g_photo_cache (key, place_id, path, fetched_at, expires_at) VALUES (?,?,?,?,?)",
    [k, null, path, now(), now() + ttlMs("cache_ttl_photos_days", "days", 30)],
  );
  return { path, cache: "MISS" };
}

// ---- Routes API(computeRoutes,含 transit alternatives)----

export type Waypoint =
  | { lat: number; lng: number }
  | { placeId: string }
  | { address: string };

export type RouteAlternative = {
  altIndex: number;
  mode: string;
  durationMin: number;
  distanceM: number;
  encodedPolyline: string;
  fare?: string;
  departureTime?: string;
  arrivalTime?: string;
  transitSummary?: string;
  steps?: Array<{
    mode: string;
    line?: string;
    headsign?: string;
    departureStop?: string;
    arrivalStop?: string;
    departureTime?: string;
    arrivalTime?: string;
    numStops?: number;
    durationMin?: number;
  }>;
};

const MODE_MAP: Record<string, string> = {
  walk: "WALK",
  transit: "TRANSIT",
  drive: "DRIVE",
  taxi: "DRIVE",
  bike: "BICYCLE",
};

function toWaypoint(w: Waypoint): Record<string, unknown> {
  if ("placeId" in w) return { placeId: w.placeId };
  if ("address" in w) return { address: w.address };
  return { location: { latLng: { latitude: w.lat, longitude: w.lng } } };
}

function fmtTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: process.env.TZ,
  });
}

export async function directions(args: {
  from: Waypoint;
  to: Waypoint;
  mode: string;
  departureTime?: string; // ISO 或 HH:MM(套用到今天)
}): Promise<{ alternatives: RouteAlternative[]; cache: "HIT" | "MISS"; note?: string }> {
  const travelMode = MODE_MAP[args.mode] ?? "TRANSIT";

  // 出發時間 bucket 到 15 分鐘做快取 key
  let departIso: string | undefined;
  if (args.departureTime) {
    const d = /^\d{2}:\d{2}$/.test(args.departureTime)
      ? new Date(`${new Date().toISOString().slice(0, 10)}T${args.departureTime}:00`)
      : new Date(args.departureTime);
    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
      d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
      departIso = d.toISOString();
    }
  }

  const cacheKey = hash(
    `dir|${JSON.stringify(toWaypoint(args.from))}|${JSON.stringify(toWaypoint(args.to))}|${travelMode}|${departIso ?? ""}`,
  );
  const hit = cacheGet("g_directions_cache", "key", cacheKey);
  if (hit) return { alternatives: JSON.parse(hit.payload), cache: "HIT" };

  chargeUsage("routes");
  const body: Record<string, unknown> = {
    origin: toWaypoint(args.from),
    destination: toWaypoint(args.to),
    travelMode,
    computeAlternativeRoutes: true,
    languageCode: "zh-TW",
  };
  if (travelMode === "TRANSIT") {
    if (departIso) body.departureTime = departIso;
    body.transitPreferences = { routingPreference: "FEWER_TRANSFERS" };
  }

  const fieldMask = [
    "routes.duration",
    "routes.distanceMeters",
    "routes.polyline.encodedPolyline",
    "routes.legs.steps.transitDetails",
    "routes.legs.steps.travelMode",
    "routes.legs.steps.staticDuration",
    "routes.legs.stepsOverview",
    "routes.travelAdvisory.transitFare",
  ].join(",");

  const data = (await gFetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    { method: "POST", body: JSON.stringify(body) },
    fieldMask,
  )) as {
    routes?: Array<{
      duration?: string;
      distanceMeters?: number;
      polyline?: { encodedPolyline?: string };
      travelAdvisory?: {
        transitFare?: { currencyCode?: string; units?: string; nanos?: number };
      };
      legs?: Array<{
        steps?: Array<{
          travelMode?: string;
          staticDuration?: string;
          transitDetails?: {
            headsign?: string;
            stopCount?: number;
            stopDetails?: {
              departureStop?: { name?: string };
              arrivalStop?: { name?: string };
            };
            localizedValues?: {
              departureTime?: { time?: { text?: string } };
              arrivalTime?: { time?: { text?: string } };
            };
            transitLine?: { name?: string; nameShort?: string };
          };
        }>;
      }>;
    }>;
  };

  const parseDur = (d?: string) => (d ? Math.round(Number(d.replace("s", "")) / 60) : 0);

  const alternatives: RouteAlternative[] = (data.routes ?? []).map((r, i) => {
    const steps = (r.legs?.[0]?.steps ?? [])
      .filter((s) => s.travelMode === "TRANSIT" || parseDur(s.staticDuration) >= 2)
      .map((s) => {
        const td = s.transitDetails;
        return {
          mode: s.travelMode === "TRANSIT" ? "transit" : (s.travelMode ?? "WALK").toLowerCase(),
          line: td?.transitLine?.nameShort ?? td?.transitLine?.name,
          headsign: td?.headsign,
          departureStop: td?.stopDetails?.departureStop?.name,
          arrivalStop: td?.stopDetails?.arrivalStop?.name,
          departureTime: td?.localizedValues?.departureTime?.time?.text,
          arrivalTime: td?.localizedValues?.arrivalTime?.time?.text,
          numStops: td?.stopCount,
          durationMin: parseDur(s.staticDuration),
        };
      });
    const transitSteps = steps.filter((s) => s.line);
    const fare = r.travelAdvisory?.transitFare;
    const fareText =
      fare?.units != null
        ? `${fare.currencyCode === "JPY" ? "¥" : (fare.currencyCode ?? "")}${fare.units}`
        : undefined;
    return {
      altIndex: i,
      mode: args.mode,
      durationMin: parseDur(r.duration),
      distanceM: r.distanceMeters ?? 0,
      encodedPolyline: r.polyline?.encodedPolyline ?? "",
      fare: fareText,
      departureTime: transitSteps[0]?.departureTime ?? fmtTime(departIso),
      arrivalTime: transitSteps.at(-1)?.arrivalTime,
      transitSummary: transitSteps
        .map((s) => s.line)
        .filter(Boolean)
        .join(" → ") || undefined,
      steps: steps.length > 0 ? steps : undefined,
    };
  });

  const isTransit = travelMode === "TRANSIT";
  // 空結果不進快取:日本等地區 Google API 不提供 transit 資料(授權限制),
  // 快取空陣列會讓之後的查詢永遠拿不到說明。
  if (alternatives.length > 0) {
    db.run(
      "INSERT OR REPLACE INTO g_directions_cache (key, payload, fetched_at, expires_at) VALUES (?,?,?,?)",
      [
        cacheKey,
        JSON.stringify(alternatives),
        now(),
        now() +
          (isTransit
            ? ttlMs("cache_ttl_directions_transit_hours", "hours", 6)
            : ttlMs("cache_ttl_directions_other_days", "days", 7)),
      ],
    );
  }
  return {
    alternatives,
    cache: "MISS",
    note:
      alternatives.length === 0 && isTransit
        ? "Google API 不提供此區域的大眾運輸路線資料(日本等地的授權限制,Google 地圖 App 有但 API 沒有)。班次請改用網路查詢,或改查步行/開車時間。"
        : undefined,
  };
}
