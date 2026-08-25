import { db, now } from "./db";

// 所有可在後台調整的設定與預設值(.env 只有 DB/secret/管理員帳密)。
export const SETTING_DEFAULTS: Record<string, string> = {
  app_title: "tabimate",
  google_maps_api_key: "",
  google_maps_browser_key: "",
  agent_model: "claude-opus-5",
  agent_max_turns: "50",
  agent_stall_timeout_sec: "300",
  agent_system_prompt_extra: "",
  cache_ttl_autocomplete_days: "30",
  cache_ttl_place_details_days: "7",
  cache_ttl_directions_transit_hours: "6",
  cache_ttl_directions_other_days: "7",
  cache_ttl_photos_days: "30",
  // 每月對 Google 的實際呼叫上限(快取命中不計;0 = 不限制)。
  // 對齊 Google 免費額度的月度計算,單日用量大也不會被卡;預設 = 月免費額 × 0.9 保守值:
  // autocomplete/routes 屬 Essentials 1 萬/月;place details/photos 含營業時間評分屬 Enterprise 1 千/月。
  limit_autocomplete_monthly: "9000",
  limit_place_details_monthly: "900",
  limit_photos_monthly: "900",
  limit_routes_monthly: "9000",
  limit_staticmap_monthly: "9000",
};

export function seedSettings() {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?,?,?)",
  );
  for (const [k, v] of Object.entries(SETTING_DEFAULTS)) stmt.run(k, v, now());
}

export function getSetting(key: string): string {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | null;
  return row?.value ?? SETTING_DEFAULTS[key] ?? "";
}

export function getAllSettings(): Record<string, string> {
  const rows = db.query("SELECT key, value FROM settings").all() as Array<{
    key: string;
    value: string;
  }>;
  const out: Record<string, string> = { ...SETTING_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function putSettings(patch: Record<string, string>) {
  const stmt = db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  const t = now();
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in SETTING_DEFAULTS)) continue; // 不接受未知 key
    stmt.run(k, String(v), t);
  }
}
