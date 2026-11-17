import { spawnSync } from "node:child_process";

if (process.env.VITE_CAD_KERNEL !== "opencascade") {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, "run", "test:plainsolid"], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
