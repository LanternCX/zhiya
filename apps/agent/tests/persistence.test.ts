import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

test("a course can save its terminal state after an earlier save fails", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zhiya-persistence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await symlink(resolve("../../node_modules"), join(directory, "node_modules"));
  const outfile = join(directory, "course.mjs");
  await build({ entryPoints: ["src/runtime/course.ts"], bundle: true, packages: "external", outfile, platform: "node", format: "esm" });
  const { CourseHost } = await import(pathToFileURL(outfile).href);
  const apiFile = join(directory, "api.mjs");
  await build({ entryPoints: ["src/adapters/api.ts"], bundle: true, outfile: apiFile, platform: "node", format: "esm" });
  const { ToolAPI } = await import(pathToFileURL(apiFile).href);
  let fail = true;
  let saved: any;
  const api = createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    if (fail) {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end('{"error":"temporary failure"}');
    } else {
      saved = JSON.parse(Buffer.concat(parts).toString());
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
    }
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  t.after(() => { api.closeAllConnections(); api.close(); });
  const state = { course: null, conversationId: "conversation", lesson: { messages: [], pages: [], presentations: [], currentPresentationId: "" }, busy: false, generating: false };
  const host = new CourseHost(new ToolAPI(`http://127.0.0.1:${(api.address() as { port: number }).port}`, "test", "session", "grant"), { id: "test", available: false }, "", state);
  t.after(() => host.shutdown());
  await assert.rejects(host.flush(), /temporary failure/);
  fail = false;
  await host.command("stop", []);
  assert.equal(saved.running, false);
  assert.equal(saved.busy, false);
});
