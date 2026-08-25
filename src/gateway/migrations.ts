import type { Database } from "bun:sqlite";

// 以 PRAGMA user_version 控管;每個 migration 一次交易。
const MIGRATIONS: string[] = [
  // v1 — 完整初始 schema
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE trips (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    destination TEXT,
    start_date TEXT,
    status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN ('planning','active','archived')),
    itinerary_rev INTEGER NOT NULL DEFAULT 0,
    agent_session_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    UNIQUE(trip_id, name)
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('user','admin')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE days (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE stops (
    id TEXT PRIMARY KEY,
    day_id TEXT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('lodging','food','cafe','sight','shopping','activity','transit-hub','other')),
    start_time TEXT,
    end_time TEXT,
    place_id TEXT,
    lat REAL,
    lng REAL,
    address TEXT,
    place_json TEXT,
    notes TEXT NOT NULL DEFAULT '',
    verify_status TEXT NOT NULL DEFAULT 'unverified' CHECK(verify_status IN ('unverified','verified','stale')),
    verify_sources TEXT NOT NULL DEFAULT '[]',
    verified_at INTEGER,
    booking_type TEXT NOT NULL DEFAULT 'none' CHECK(booking_type IN ('none','reservation_required','ticket_required','recommended','walk_in_queue')),
    booking_status TEXT NOT NULL DEFAULT 'not_booked' CHECK(booking_status IN ('not_booked','booked','unavailable')),
    booking_json TEXT,
    updated_at INTEGER NOT NULL,
    updated_by_user_id TEXT
  );
  CREATE INDEX idx_stops_day ON stops(day_id, position);

  CREATE TABLE legs (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    from_stop_id TEXT NOT NULL UNIQUE REFERENCES stops(id) ON DELETE CASCADE,
    to_stop_id TEXT NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'walk' CHECK(mode IN ('walk','transit','drive','taxi','bike','flight','other')),
    duration_min INTEGER,
    distance_m INTEGER,
    departure_time TEXT,
    arrival_time TEXT,
    transit_json TEXT,
    notes TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE proposals (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected','failed_conflict','superseded')),
    summary TEXT NOT NULL,
    changeset TEXT NOT NULL,
    base_rev INTEGER NOT NULL,
    requested_by_user_id TEXT,
    chat_message_id TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by_user_id TEXT,
    resolution_note TEXT,
    applied_version_id TEXT
  );
  CREATE INDEX idx_proposals_trip ON proposals(trip_id, status);

  CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    rev INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    change_kind TEXT NOT NULL CHECK(change_kind IN ('user_edit','proposal_apply','rollback')),
    actor_user_id TEXT,
    agent_involved INTEGER NOT NULL DEFAULT 0,
    proposal_id TEXT,
    restored_from_version_id TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(trip_id, rev)
  );

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    user_id TEXT,
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('queued','streaming','complete','stopped','error')),
    error TEXT,
    session_id TEXT,
    model TEXT,
    attachment_ids TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    UNIQUE(trip_id, seq)
  );

  CREATE TABLE chat_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_chat_blocks_msg ON chat_blocks(message_id, idx);

  CREATE TABLE agent_jobs (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    chat_message_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','stopped','error')),
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );

  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    uploader_user_id TEXT,
    chat_message_id TEXT,
    stop_id TEXT,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE g_autocomplete_cache (
    key TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE g_place_cache (
    place_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE g_photo_cache (
    key TEXT PRIMARY KEY,
    place_id TEXT,
    path TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE g_directions_cache (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  // v2 — Google API 每日用量計數(app 端上限,防超出免費額度)
  `
  CREATE TABLE g_usage (
    date TEXT NOT NULL,
    kind TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, kind)
  );
  `,
  // v3 — 上限從每日制改為月制(對齊 Google 月度免費額度),清掉舊 key 讓新預設生效
  `
  DELETE FROM settings WHERE key IN (
    'limit_autocomplete_daily','limit_place_details_daily','limit_photos_daily','limit_routes_daily'
  );
  `,
  // v4 — 行程可在登入頁隱藏(內部測試用;仍可透過直達連結登入)
  `
  ALTER TABLE trips ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
  `,
  // v5 — 交通段「需重新確認」旗標(相鄰地點移動/改時間後自動標記)
  `
  ALTER TABLE legs ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
  `,
  // v6 — 塔比回覆記錄回覆對象(聊天引用氣泡)
  `
  ALTER TABLE chat_messages ADD COLUMN reply_to_message_id TEXT;
  `,
  // v7 — 住宿住幾晚(連泊範圍;僅 lodging 有意義)
  `
  ALTER TABLE stops ADD COLUMN nights INTEGER NOT NULL DEFAULT 1;
  `,
  // v8 — 塔比上次讀取 prompt 時的行程版本(開場比對 versions 告知期間變更/回滾)
  `
  ALTER TABLE trips ADD COLUMN agent_last_rev INTEGER NOT NULL DEFAULT 0;
  `,
  // v9 — 續住日的住宿錨點:當天幾點離開/回到住宿,與住宿↔頭尾行程的交通段(JSON)
  `
  ALTER TABLE days ADD COLUMN lodging_depart_time TEXT;
  ALTER TABLE days ADD COLUMN lodging_return_time TEXT;
  ALTER TABLE days ADD COLUMN lodging_morning_leg TEXT;
  ALTER TABLE days ADD COLUMN lodging_evening_leg TEXT;
  `,
  // v10 — 聊天 @ 提及(指名天/地點/交通給塔比)
  `
  ALTER TABLE chat_messages ADD COLUMN mentions TEXT NOT NULL DEFAULT '[]';
  `,
];

export function migrate(db: Database) {
  const current = (db.query("PRAGMA user_version").get() as { user_version: number })
    .user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.run(MIGRATIONS[v]);
      db.run(`PRAGMA user_version = ${v + 1}`);
    })();
    console.log(`[db] migrated to v${v + 1}`);
  }
}
