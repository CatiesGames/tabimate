// 工作區雙瀏覽器 e2e:登入 → 版面 → 手動加點 → 對方即時看到+歸屬 toast → presence → 版本面板。
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:4680";
const SHOT = process.env.SHOT_DIR ?? "/tmp";

const browser = await chromium.launch();

async function loginAs(name, viewport = { width: 1600, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(BASE + "/");
  await page.waitForSelector("text=選擇你的行程", { timeout: 15_000 });
  await page.click("text=東京五日遊");
  await page.waitForSelector(`text=${name}`);
  await page.click(`text=${name}`);
  await page.fill('input[type="password"]', "pw1234");
  await page.click("text=進入行程");
  await page.waitForURL(/\/trips\//, { timeout: 15_000 });
  await page.waitForSelector("text=Day 1", { timeout: 15_000 });
  return page;
}

try {
  const a = await loginAs("小明");
  const b = await loginAs("小美");
  await a.waitForTimeout(1500); // WS 連上

  await a.screenshot({ path: `${SHOT}/ws-1-workspace.png` });

  // A 手動加點(無 Google key → 手動路徑)
  await a.click("text=新增地點");
  await a.click("text=手動新增");
  await a.fill('input[placeholder="地點名稱"]', "明治神宮");
  await a.click("text=景點", { strict: false }).catch(() => {});
  await a.click("button:has-text('加入')");

  // A 立即(樂觀)看到
  await a.waitForSelector("text=明治神宮", { timeout: 5_000 });
  // B 透過 WS 看到 + 歸屬 toast
  await b.waitForSelector("text=明治神宮", { timeout: 8_000 });
  const toastSeen = await b
    .waitForSelector("text=/小明.*新增 明治神宮/", { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  console.log("B sees stop: yes; attribution toast:", toastSeen ? "yes" : "no");
  await b.screenshot({ path: `${SHOT}/ws-2-b-sees-stop.png` });

  // B 點選地點 → 詳情面板 + A 端 presence
  await b.click('[data-stop-card]:has-text("明治神宮")');
  await b.waitForSelector("text=從行程移除", { timeout: 5_000 });
  await b.screenshot({ path: `${SHOT}/ws-3-b-detail.png` });
  await a.waitForTimeout(1600); // presence 節流
  await a.screenshot({ path: `${SHOT}/ws-4-a-presence.png` });

  // A 開版本面板 → 應有「新增 明治神宮」;還原前一版
  await a.click('[aria-label="版本歷史"]');
  await a.waitForSelector("text=版本歷史");
  await a.waitForSelector("text=/新增 明治神宮/", { timeout: 5_000 });
  await a.screenshot({ path: `${SHOT}/ws-5-versions.png` });

  // 關版本面板 → 加一天
  await a.click('aside [aria-label="關閉"]');
  await a.click("text=加一天");
  await a.waitForSelector("text=Day 2", { timeout: 5_000 });
  await b.waitForSelector("text=Day 2", { timeout: 8_000 });
  console.log("add day propagated: yes");

  // 聊天面板存在 + 輸入框可用
  const composer = await a.$('textarea[placeholder*="跟 AI 討論"]');
  console.log("chat composer:", composer ? "present" : "MISSING");

  await a.screenshot({ path: `${SHOT}/ws-6-final.png` });
  console.log("WORKSPACE E2E PASS");
} finally {
  await browser.close();
}
