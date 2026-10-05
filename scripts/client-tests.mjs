import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cli = require.resolve("@playwright/test/cli");
const args = process.argv.slice(2);
const shardIndex = args.findIndex(
  arg => arg === "--shard" || arg.startsWith("--shard="),
);
let directory;

function run(options, stdio = "inherit") {
  const result = spawnSync(process.execPath, [cli, "test", ...options], {
    stdio,
    encoding: "utf8",
    env: stdio === "pipe" ? { ...process.env, FORCE_COLOR: "0" } : process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    process.exitCode = result.status ?? 1;
    return null;
  }
  return result;
}

try {
  if (shardIndex >= 0) {
    const option = args[shardIndex];
    const value = option === "--shard"
      ? args.splice(shardIndex, 2)[1]
      : args.splice(shardIndex, 1)[0].slice(8);
    const match = /^(\d+)\/(\d+)$/.exec(value ?? "");
    const current = Number(match?.[1]);
    const total = Number(match?.[2]);
    if (
      !Number.isSafeInteger(current) || !Number.isSafeInteger(total) ||
      current < 1 || current > total
    ) {
      throw new Error("Expected --shard=current/total with 1 <= current <= total");
    }
    // Use Playwright's public list format so project and nested test titles survive filtering.
    const listed = run([...args, "--list", "--reporter=list"], "pipe");
    if (listed) {
      const tests = [...new Set(listed.stdout.split("\n")
        .map(line => line.trim())
        .filter(line => line.startsWith("[")))];
      const selected = tests.filter((_, index) => index % total === current - 1);
      if (!selected.length) throw new Error("The selected shard contains no tests");
      directory = mkdtempSync(join(tmpdir(), "zhiya-client-tests-"));
      const file = join(directory, "tests.txt");
      writeFileSync(file, selected.join("\n") + "\n");
      run([...args, "--test-list", file]);
    }
  } else {
    run(args);
  }
} finally {
  if (directory) rmSync(directory, { recursive: true, force: true });
}
