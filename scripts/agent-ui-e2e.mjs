// M7d live e2e:瀏覽器中真 agent 對話 → 提案卡確認 → 交通選項卡點選 → 時間軸即時更新。
// 測試用 sonnet 模型,結束切回 opus。
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:4680";
const GW = "http://127.0.0.1:4681";
const SHOT = process.env.SHOT_DIR ?? "/tmp";

async function setModel(model) {
  const res = await fetch(`${GW}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "tabimate-dev" }),
  });
  const cookie = res.headers.get("set-cookie").split(";")[0];
  await fetch(`${GW}/api/admin/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ agent_model: model }),
  });
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();

try {
  await setModel("claude-sonnet-5");

  await page.goto(BASE + "/");
  await page.waitForSelector("text=選擇你的行程");
  await page.click("text=東京五日遊");
  await page.click("text=小明");
  await page.fill('input[type="password"]', "pw1234");
  await page.click("text=進入行程");
  await page.waitForSelector("text=Day 1", { timeout: 15_000 });
  await page.waitForTimeout(1200);

  const composer = 'textarea[placeholder*="跟 AI 討論"]';

  // ---- 提案卡流程 ----
  await page.fill(
    composer,
    "請提案把 Day 2 加上「東京晴空塔」10:00,分類 sight,標記需購票(bookingType ticket_required)。先讀行程再提案,不要查網路,不要多做其他事。",
  );
  await page.keyboard.press("Enter");
  // 狀態列有動靜
  await page.waitForSelector("text=/思考中|排隊|查資料|回覆中|讀取/", { timeout: 30_000 });
  // 提案卡出現
  await page.waitForSelector("button:has-text('確認套用')", { timeout: 240_000 });
  await page.screenshot({ path: `${SHOT}/ai-1-proposal-card.png` });
  await page.click("button:has-text('確認套用')");
  // 卡片轉為已套用 + Day2 出現晴空塔
  await page.waitForSelector("text=/已套用/", { timeout: 20_000 });
  await page.click("text=Day 2");
  await page.waitForSelector('[data-stop-card]:has-text("晴空塔")', { timeout: 10_000 });
  await page.screenshot({ path: `${SHOT}/ai-2-applied.png` });
  console.log("proposal card flow: PASS");

  // 等本輪結束
  await page.waitForSelector("text=隨時待命", { timeout: 120_000 });

  // ---- 交通選項卡流程 ----
  await page.click("text=Day 1");
  await page.fill(
    composer,
    "用 present_transit_options 呈現「一蘭拉麵」到「東京鐵塔」的兩個交通選項:電車(約25分,¥200,推薦)與計程車(約12分,¥1800)。不要查網路,粗估即可;legOp 用 set_leg,fromStopId 用行程中「一蘭拉麵」(不是上野店)的 id,mode 對應選項。呈現完就結束。",
  );
  await page.keyboard.press("Enter");
  await page.waitForSelector("text=的交通方式", { timeout: 240_000 });
  await page.screenshot({ path: `${SHOT}/ai-3-transit-card.png` });
  // 點電車選項
  await page.click("button:has-text('電車')");
  await page.waitForSelector("text=已選擇並套用", { timeout: 20_000 });
  await page.screenshot({ path: `${SHOT}/ai-4-transit-selected.png` });
  console.log("transit options flow: PASS");

  console.log("AGENT UI E2E PASS");
} finally {
  await setModel("claude-opus-5");
  await browser.close();
}
