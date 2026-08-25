// 正式啟動:gateway(4681) + next start(4680),Ctrl-C 一起收掉。
// 需先 `bun run build`;更新流程見 README「更新」。
import { spawn } from "bun";

const procs = [
  spawn(["bun", "src/gateway/index.ts"], {
    stdout: "inherit",
    stderr: "inherit",
  }),
  spawn(["bun", "x", "next", "start", "-p", "4680"], {
    stdout: "inherit",
    stderr: "inherit",
  }),
];

const shutdown = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 任一子程序死掉就整組收掉,避免半死狀態(重啟交給使用者或 launchd)
await Promise.race(procs.map((p) => p.exited));
shutdown();
