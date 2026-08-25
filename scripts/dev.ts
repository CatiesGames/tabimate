// 一鍵啟動 gateway + web dev server,Ctrl-C 一起收掉。
import { spawn } from "bun";

const procs = [
  spawn(["bun", "--watch", "src/gateway/index.ts"], {
    stdout: "inherit",
    stderr: "inherit",
  }),
  spawn(["bun", "x", "next", "dev", "-p", "4680"], {
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

await Promise.all(procs.map((p) => p.exited));
