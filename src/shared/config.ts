// 兩側(Next 前端 / Bun gateway)共用的常數。
// port 刻意寫死:.env 白名單只允許 DB 路徑、session secret、管理員帳密(單機自架,無 port 需求)。

export const WEB_PORT = 4680;
export const GATEWAY_PORT = 4681;

export const SESSION_COOKIE = "tm_sess";
export const ADMIN_COOKIE = "tm_admin";

/** 使用者 session:7 天滑動過期,任何已認證請求都刷新。 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 距上次刷新超過此間隔才真的寫 DB / 重發 cookie,避免每個請求都寫。 */
export const SESSION_REFRESH_MIN_MS = 60 * 60 * 1000;
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const WS_TICKET_TTL_MS = 60 * 1000;

export const STOP_CATEGORIES = [
  "lodging",
  "food",
  "cafe",
  "sight",
  "shopping",
  "activity",
  "transit-hub",
  "other",
] as const;
export type StopCategory = (typeof STOP_CATEGORIES)[number];

export const LEG_MODES = [
  "walk",
  "transit",
  "drive",
  "taxi",
  "bike",
  "flight",
  "other",
] as const;
export type LegMode = (typeof LEG_MODES)[number];

export const BOOKING_TYPES = [
  "none",
  "reservation_required",
  "ticket_required",
  "recommended",
  "walk_in_queue",
] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

export const BOOKING_STATUSES = ["not_booked", "booked", "unavailable"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const VERIFY_STATUSES = ["unverified", "verified", "stale"] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];

/** agent 在 presence roster 中的偽成員 id。 */
export const AGENT_USER_ID = "agent";

/** 使用者頭像色盤(後台建使用者時挑選)。 */
export const AVATAR_COLORS = [
  "#FF5D47", // 珊瑚
  "#0E9BA4", // 海洋青(與 agent 同色系但 agent 有機器人 icon 區隔)
  "#E8A50C", // 琥珀
  "#2FA866", // 葉綠
  "#8B5CF6", // 紫羅蘭
  "#EC4899", // 桃粉
  "#3B82F6", // 天藍
  "#C2410C", // 陶土
] as const;

