// 一鍵更新:git pull → bun install → next build。
// 資料都在 data/(gitignored)不受影響;DB schema 由 gateway 啟動時自動遷移。
// 完成後重啟服務(Ctrl-C 停掉 `bun run start` 再跑一次)即完成升級。
import { spawnSync } from "bun";

const steps: Array<[string, string[]]> = [
  ["拉取新版本", ["git", "pull", "--ff-only"]],
  ["安裝依賴", ["bun", "install"]],
  ["編譯前端", ["bun", "x", "next", "build"]],
];

for (const [label, cmd] of steps) {
  console.log(`\n[update] ${label}:${cmd.join(" ")}`);
  const r = spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) {
    console.error(`\n[update] 「${label}」失敗(exit ${r.exitCode}),已中止。`);
    process.exit(r.exitCode ?? 1);
  }
}
console.log("\n[update] 完成。重啟服務即生效:停掉 `bun run start` 再重新執行。");
