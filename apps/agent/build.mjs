import { build } from "esbuild";
import { spawn } from "node:child_process";

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  sourcemap: true,
});
if (process.argv.includes("--run")) {
  const child = spawn(process.execPath, ["dist/server.mjs"], {
    stdio: "inherit",
    env: process.env,
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
