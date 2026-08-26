# tabimate

多人協作旅遊行程規劃器 — 自架於一台 Mac,家人朋友透過區網共同編輯行程,內建由本機 `claude` CLI 驅動的 AI 旅遊嚮導「塔比」(可讀寫整份行程:提案 → 任一成員確認 → 套用 + 版本記錄;需要成員拍板時會出選項卡,點選即套用並記錄是誰選的)。

行程防呆:改時間造成順序衝突會出警示(不自動重排);移動地點或改時間後,相鄰交通段自動標記「需重新確認」;交通支援多段轉車(每段各自的路線與時刻)。

## 架構

```
瀏覽器 ──HTTP──▶ Next.js (port 4680,純前端 + /api rewrite)
   │                        │
   └────WS──▶ Gateway (Bun, port 4681)
              ├─ REST /api/*(唯一後端、唯一 SQLite writer)
              ├─ WS /ws(即時同步:行程/聊天/提案/presence)
              ├─ MCP /mcp(agent 工具,per-job Bearer token)
              └─ agent runner(claude -p 子程序,per-turn spawn + --resume)
```

- 資料庫:SQLite(WAL),單檔 `data/tabimate.db`,備份 = 複製檔案
- 版本化:每次變更存全量快照,可回滾到任意版本(回滾本身也是版本)
- Agent 與使用者共用同一個 changeset 引擎(`src/shared/changeset.ts`)

## 需求

- [Bun](https://bun.sh) 1.3+
- [Claude Code CLI](https://claude.com/claude-code)(`claude` 在 PATH 上且已登入)— AI 助手用
- Google Maps Platform API key(可後補;沒有時地圖降級為示意圖、地點手動輸入)

## 部署(本機正式跑)

```bash
git clone https://github.com/CatiesGames/tabimate.git
cd tabimate
bun install
cp .env.example .env     # 填入 SESSION_SECRET(隨機 32+ 字元)與管理員帳密
bun run build            # 編譯前端
bun run start            # 一鍵啟動 gateway(4681) + web(4680),Ctrl-C 一起停
```

第一次使用:

1. 開 `http://localhost:4680/admin` → 用 .env 的管理員帳密登入
2. 「行程與成員」→ 建立行程 → 在行程裡新增成員(名稱+密碼)
3. 成員開 `http://<你的區網IP>:4680` → 選行程 → 點自己的頭像 → 輸入密碼

小技巧:後台行程列的「開啟行程」按鈕可直達該行程;行程可設「登入頁隱藏」(內部測試用,
不出現在成員的行程選擇頁,但直達連結 `/trips/<id>` 仍可登入)。

想常駐背景跑:`nohup bun run start > tabimate.log 2>&1 &`(或掛 launchd;
`launchctl bootstrap` 後要再 `launchctl kickstart` 才會立刻啟動)。

### HTTPS 網域部署(反向代理)

要用自己的網域 + HTTPS 對外時,前端會自動改走**同源 WebSocket**(`wss://你的網域/ws`),
所以反代必須把 `/ws` 轉給 gateway,其餘轉給 web。Caddy 範例:

```caddyfile
tabimate.example.com {
    reverse_proxy /ws 127.0.0.1:4681
    reverse_proxy /api/* 127.0.0.1:4681   # 可省略(Next 會轉),直代少一跳
    reverse_proxy 127.0.0.1:4680
}
```

- gateway(4681)只有明文,**不要**讓瀏覽器直連 `:4681`(HTTPS 頁面會被 mixed content 擋)
- 本機/區網 http 直連不受影響,前端仍直連 `ws://主機:4681/ws`
- cookie 沒有 `Secure` flag(見下方安全取捨),HTTPS 下瀏覽器照常接受

## 更新

```bash
bun run update           # = git pull → bun install → bun run build
# 然後重啟:Ctrl-C 停掉 bun run start,再跑一次 bun run start
```

- 資料(行程、對話、照片快取)都在 `data/`,不進 git,更新不會動到
- 資料庫 schema 由 gateway 啟動時自動遷移(PRAGMA user_version),不需手動步驟
- 備份 = 複製整個 `data/` 目錄(SQLite 單檔 + 附件/照片快取)

## 開發

```bash
bun run dev              # gateway(4681, --watch) + next dev(4680)
```

> 手機/平板走區網連 dev server 時,把該裝置看到的電腦 IP 加進 `next.config.ts` 的
> `allowedDevOrigins`(僅 dev 需要;正式跑不用)。

## .env(僅此四項;其餘設定都在後台 /admin/settings)

```
TABIMATE_DB_PATH=./data/tabimate.db
SESSION_SECRET=<32+ 隨機字元>
ADMIN_USERNAME=...
ADMIN_PASSWORD=...
```

## Google Maps key 申請與免費額度

完整逐步教學(含直達連結)在後台 /admin/settings →「還沒有金鑰?看完整免費申請流程」。摘要:

1. 建立 GCP 專案 → 啟用計費(須綁卡)
2. 啟用 API:**Maps JavaScript API**、**Places API (New)**、**Routes API**
3. 兩把憑證:伺服器 key(限制 API 為 Places/Routes)、瀏覽器 key(HTTP referrer 限制)
4. 貼進後台存檔即全端點亮(免重啟)

### 免費額度(2025/3 新制)與三層防護

每個 API 每月免費呼叫:地圖載入/地點搜尋/路線 = 10,000 次(Essentials);
**地點詳情(含營業時間/評分)與地點照片 = 僅 1,000 次(Enterprise 級)**。

1. **Google 端 quota 硬鎖**(指南第 7 步):Google 端只有每日制,當寬鬆兜底(Maps JS/Autocomplete/Routes 1000/日,Details/Photos 100/日)— 平常碰不到,key 外洩被盜刷時 Google 直接擋請求而非收費
2. **app 內建每月上限**(後台「免費額度防護」,預設已開,對齊 Google 的月度免費額計算,單日用量大也不會被卡):只計實際打到 Google 的呼叫,本月累計達標自動降級(搜尋轉手動、照片轉色塊),下月 1 號恢復;後台即時看本月/今日用量
3. **SQLite 快取**:autocomplete 30 天、詳情 7 天、照片 30 天磁碟快取(縮圖與詳情共用同一尺寸,同一張照片只算一次)、路線 6 小時-7 天

## Agent 權限模型(實測驗證)

- `--tools "Read,WebSearch,WebFetch"`:工具集只有這三個內建工具,**沒有 Bash/檔案寫入**
- 不使用 `--dangerously-skip-permissions`;`--allowedTools` 只放行:WebSearch、WebFetch、`mcp__tabimate`(行程工具)、`Read(//<附件目錄>/**)`
- 結論:agent 只能讀成員上傳的附件圖,讀其他本機檔案會被工具層直接拒絕;不能執行任何指令;行程修改一律經提案 + 人為確認

## 安全取捨(刻意設計,信任區網)

- 平文 HTTP、cookie 無 `Secure` flag — 僅限家用區網,勿暴露公網
- 登入頁的行程/成員名單未登入可見(選人再輸入密碼)
- 使用者 session 7 天滑動過期(有操作就續命)
- AI 助手工具面:`--tools "Read,WebSearch,WebFetch"` + 專屬 MCP 工具,無 Bash/檔案寫入;
  行程修改一律經提案 + 人為確認

## 測試

```bash
bun test                          # changeset 引擎單元測試
bun scripts/ws-smoke.ts           # WS 即時同步冒煙(需 gateway 在跑)
bun scripts/proposal-smoke.ts     # 提案/MCP 冒煙
bun scripts/agent-smoke.ts        # 真 agent 全環冒煙(會呼叫 claude,花 token)
bun scripts/workspace-e2e.mjs     # 雙瀏覽器協作 e2e(需兩服務在跑)
bun scripts/agent-ui-e2e.mjs      # 瀏覽器內真 agent 提案卡/交通卡 e2e(花 token)
```
