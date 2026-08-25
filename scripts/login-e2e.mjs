// 登入流程 e2e:行程卡 → 頭像 → 密碼 → 進工作區。附截圖。
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:4680";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  await page.goto(BASE + "/");
  await page.waitForSelector("text=選擇你的行程", { timeout: 10_000 });
  await page.screenshot({ path: `${SHOT_DIR}/login-1-trips.png` });

  await page.click("text=東京五日遊");
  await page.waitForSelector("text=你是哪一位", { timeout: 5_000 });
  await page.waitForSelector("text=小明");
  await page.screenshot({ path: `${SHOT_DIR}/login-2-users.png` });

  await page.click("text=小明");
  await page.waitForSelector('input[type="password"]', { timeout: 5_000 });

  // 先試錯誤密碼
  await page.fill('input[type="password"]', "wrong");
  await page.click("text=進入行程");
  await page.waitForSelector("text=密碼不正確", { timeout: 5_000 });
  await page.screenshot({ path: `${SHOT_DIR}/login-3-error.png` });

  await page.fill('input[type="password"]', "pw1234");
  await page.click("text=進入行程");
  await page.waitForURL(/\/trips\//, { timeout: 8_000 });
  await page.waitForSelector("text=工作區建置中");
  await page.screenshot({ path: `${SHOT_DIR}/login-4-workspace.png` });

  // 重新整理仍是登入態(cookie 生效),應直接跳回工作區
  await page.goto(BASE + "/");
  await page.waitForURL(/\/trips\//, { timeout: 8_000 });

  console.log("LOGIN E2E PASS");
} finally {
  await browser.close();
}
