import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const cwd = new URL("../apps/client/", import.meta.url);
function list(...args) {
  const result = spawnSync(
    process.execPath, ["../../scripts/client-tests.mjs", "--list", ...args],
    { cwd, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("["));
}

test("alternating shards cover every browser test exactly once and share slow test files", () => {
  const all = list();
  const first = list("--shard=1/2");
  const second = list("--shard=2/2");
  assert.ok(all.length > 0);
  assert.deepEqual([...first, ...second].sort(), [...all].sort());
  assert.equal(new Set([...first, ...second]).size, all.length);
  for (const shard of [first, second]) {
    for (const file of ["course.spec.ts", "lesson-playback.spec.ts"]) {
      const total = all.filter(line => line.includes(`${file}:`)).length;
      assert.ok(total > 1);
      const selected = shard.filter(line => line.includes(`${file}:`)).length;
      assert.ok(
        selected >= Math.floor(total / 2) && selected <= Math.ceil(total / 2),
      );
    }
    assert.ok(shard.some(line => line.startsWith("[development]")));
  }
});

test("repeated runs keep each test in only one shard", () => {
  const all = list("--repeat-each=2", "--project=development");
  const first = list("--repeat-each=2", "--project=development", "--shard=1/2");
  const second = list("--repeat-each=2", "--project=development", "--shard=2/2");
  assert.deepEqual([...first, ...second].sort(), [...all].sort());
  assert.ok(first.every(line => !second.includes(line)));
});
