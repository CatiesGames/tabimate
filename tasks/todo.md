# tabimate 實作計畫（來源：~/.claude/plans/shimmying-exploring-canyon.md）

## M0 腳手架
- [x] package.json / tsconfig / postcss / next.config（rewrite → gateway 4681）/ .env / .gitignore
- [x] src/shared/config.ts（ports、常數）
- [x] gateway hello（Bun.serve 4681，/healthz）
- [x] globals.css 設計 token 系統（--tm-* + @theme inline）+ 字體（Noto Sans TC + Outfit）
- [x] 基礎 ui/ 元件（Button/Avatar/Input/SegmentedChips/Spinner/PulseDots/Skeleton/Tag/toast）
- [x] /dev/kit token 展示頁
- [x] 驗證：curl :4680/api/healthz 穿透 rewrite；/dev/kit 正常渲染

## M1 DB + Auth + 登入頁
- [x] migrations（PRAGMA user_version）+ settings/trips/users/sessions 表
- [x] 行程優先登入 API：GET /api/auth/trips → GET /api/auth/trips/:id/users → POST /api/auth/login；7d 滑動刷新
- [x] admin login（.env 帳密）+ admin API：建行程 → 行程內建使用者
- [x] ws-ticket（單次、60s TTL）
- [x] 登入頁 UI：行程卡 → 頭像格滑入 → 密碼
- [x] 驗證：curl 全流程 + 瀏覽器登入

## M2 行程資料 + Changeset 引擎 + 版本
- [x] days/stops（含 booking 欄位）/legs/versions/proposals 表
- [x] src/shared/changeset.ts：Operation 型別 + apply engine（temp-id、clamp、leg 相鄰清理）
- [x] /edit /versions /rollback API；回滾保留原 id
- [x] bun test 單元測試
- [x] 驗證：bun test 綠 + curl 劇本

## M3 WS + Presence
- [x] /ws upgrade + ticket 消費 + topic pub/sub + sub_ok 全狀態
- [x] itin_changed 廣播；presence roster（記憶體）
- [x] 前端 RtConnection port + useRealtime
- [x] scripts/ws-smoke.ts 驗證

## M4 Proposals
- [x] confirm/reject/apply/failed_conflict + WS 事件
- [x] 手鑄 job token 直打 /mcp 測 propose_changes
- [x] 驗證：ws-smoke 全流程 + 衝突路徑

## M5 Agent runner + MCP + Chat
- [x] claude --help 旗標稽核（白名單 vs 黑名單）
- [x] 佇列 + spawn/--resume + stream-json 解析 → blocks + WS fan-out
- [x] MCP 全工具（get_itinerary/get_trip_info/propose_changes/search_places/get_place_details/get_directions/present_transit_options/report_verification/present_booking_audit/list_versions/get_google_status）
- [x] stop/reset/圖片/錯誤面/stall watchdog
- [x] 驗證：真 agent 對話 → 提案 → 確認 → 下一 turn 知道結果；mid-stream stop 後 resume 正常

## M6 Google 代理 + 快取 + 降級
- [x] autocomplete/place/photo/directions 代理 + SQLite 快取 + X-Cache header
- [x] 無 key 503 降級；agent 工具接真 API
- [x] 驗證：MISS→HIT；agent 提案帶班次

## M7 前端工作區
- [x] M7a 佈局+DayTabs+Timeline+StopCard+拖曳重排+LegEditor+樂觀對帳
- [x] M7b 地圖（MapCanvas/無key SVG 示意/markers/當日 polylines/替代路線/POI 加點）
- [x] M7c 聊天面板（串流管線/狀態列/Stop/圖片/佇列/多人同看）
- [x] M7d 結構化卡片+競態+GSAP+版本面板+presence 全套（含 agent 偽成員可視化）
- [x] M7e 預約系統 UI + admin 面板 + 設定熱生效
- [x] 驗證：兩瀏覽器並排全流程

## M8 硬化
- [x] 響應式/行動版、a11y、效能、空/錯狀態
- [x] bun run build + prod scripts + README（launchd 註記、LAN 取捨、Maps key 申請步驟）
- [x] 驗證：build 過 + 行動版 viewport 全流程（實體手機 LAN 待使用者實測）
