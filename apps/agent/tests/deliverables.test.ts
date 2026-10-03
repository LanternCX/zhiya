import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("deliverable tools preserve targeted revisions and pass cancellation to storage", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zhiya-deliverable-tools-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outfile = join(dir, "tools.mjs");
  await build({
    entryPoints: ["src/pi/tools/deliverables.ts"],
    bundle: true,
    outfile,
    platform: "node",
    format: "esm",
  });
  const { deliverableTools } = await import(pathToFileURL(outfile).href);
  let saved: any;
  const tools = deliverableTools({
    write: async (id: string, request: object, signal: AbortSignal) => {
      signal.throwIfAborted();
      saved = { id, ...request };
      return { id, revision: 3 };
    },
    read: async () => ({ id: "deck", revision: 2 }),
    list: async () => [],
  });
  const edit = tools.find(
    (t: { name: string }) => t.name === "edit_deliverable",
  );
  const change = {
    action: "replace",
    blockId: "intro",
    block: {
      id: "intro",
      title: "新标题",
      markdown: "更新的内容",
      imageIds: [],
    },
  };
  const result = await edit.execute(
    "call-1",
    { id: "deck", revision: 2, changes: [change] },
    new AbortController().signal,
  );
  assert.equal(result.details.revision, 3);
  assert.equal(saved.requestId, "call-1");
  assert.equal(saved.revision, 2);
  assert.deepEqual(saved.changes, [change]);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    edit.execute(
      "call-2",
      { id: "deck", revision: 2, changes: [change] },
      abort.signal,
    ),
  );
  assert.equal(saved.requestId, "call-1");
});

test("classroom edits match original source atomically and preserve student interaction", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zhiya-classroom-edits-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outfile = join(dir, "editor.mjs");
  await build({ entryPoints: ["src/pi/tools/edit_classroom_page.ts"], bundle: true, outfile, platform: "node", format: "esm" });
  const { readEditablePage, patchClassroomPage } = await import(pathToFileURL(outfile).href);
  const page = { id: "exercise", kind: "coding", title: "变量", instructions: "first=AAA; next=BBB; 重复。重复。", starterCode: "x = 1", code: "student-private-code", stdin: "student-input", result: { stdout: "student-result" } };
  const before = readEditablePage(page);
  assert.equal(before.page.code, page.starterCode);
  assert.equal(before.page.stdin, "");
  assert.equal(before.page.result, undefined);
  assert.equal(readEditablePage({ ...page, code: "a later answer" }).version, before.version);
  const edited = patchClassroomPage(page, before.version, [
    { field: "instructions", oldText: "first=AAA", newText: "first=BBB" },
    { field: "instructions", oldText: "next=BBB", newText: "next=CCC" },
  ]);
  assert.equal(edited.updated.instructions, "first=BBB; next=CCC; 重复。重复。");
  assert.equal(edited.updated.code, page.code);
  assert.deepEqual(edited.updated.result, page.result);
  assert.throws(() => patchClassroomPage(edited.updated, before.version, [{ field: "instructions", oldText: "first", newText: "stale" }]), /重新读取/);
  assert.throws(() => patchClassroomPage(page, before.version, [
    { field: "instructions", oldText: "first=AAA", newText: "must not apply" },
    { field: "instructions", oldText: "重复。", newText: "ambiguous" },
  ]), /匹配多处/);
  assert.equal(page.instructions, "first=AAA; next=BBB; 重复。重复。");
  assert.throws(() => patchClassroomPage(page, before.version, [
    { field: "instructions", oldText: "first=AAA", newText: "first" },
    { field: "instructions", oldText: "AAA", newText: "AAA" },
  ]), /不能重叠/);
  assert.throws(() => patchClassroomPage(page, before.version, [{ field: "code", oldText: page.code, newText: "overwrite answer" }]), /不可修改/);
});
