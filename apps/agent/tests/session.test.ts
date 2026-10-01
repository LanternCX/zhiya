import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function completion(delta: object, reason: string) {
  return `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`;
}

test("a recreated agent retains model messages and tool results, isolated by user", { timeout: 20000 }, async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "zhiya-pi-"));
  const payloads: any[] = [];
  let projection: any;
  const api = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (req.url === "/course/model") {
      payloads.push(body.payload);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(payloads.length === 1
        ? completion({ role: "assistant", tool_calls: [{ index: 0, id: "tasks-call", type: "function", function: { name: "read_agent_tasks", arguments: "{}" } }] }, "tool_calls")
        : completion({ role: "assistant", content: "第一轮已完成" }, "stop"));
      return;
    }
    if (req.url?.endsWith("/state")) projection = body;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  t.after(async () => {
    api.closeAllConnections();
    api.close();
    await rm(workspace, { recursive: true, force: true });
  });
  async function start() {
    const worker = spawn(process.execPath, ["dist/server.mjs"], {
      env: { ...process.env, ZHIYA_AGENT_SECRET: "test-secret", ZHIYA_AGENT_API: `http://127.0.0.1:${(api.address() as { port: number }).port}`, ZHIYA_AGENT_LISTEN: "127.0.0.1:0", ZHIYA_AGENT_WORKSPACES: workspace },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => worker.kill("SIGTERM"));
    let errors = "";
    worker.stderr.on("data", (data) => errors += data);
    const [ready] = await once(worker.stdout, "data");
    const port = String(ready).match(/127\.0\.0\.1:(\d+)/)?.[1];
    assert.ok(port, errors);
    return { worker, url: `http://127.0.0.1:${port}/commands` };
  }
  const initial = { course: null, conversationId: "conversation-1", lesson: { messages: [], pages: [], presentations: [], currentPresentationId: "" }, busy: false, generating: false };
  async function prompt(url: string, userId: string, state: object, requestId: string, conversationId = "conversation-1") {
    const response = await fetch(url, {
      method: "POST", headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ userId, session: { id: `${userId}-${conversationId}`, kind: "course", conversationId, state }, grant: "grant", memory: "", model: { id: "test", available: true }, command: { requestId, action: "prompt", args: ["继续解释"] } }),
    });
    assert.equal(response.status, 202, await response.text());
    for (let i = 0; i < 300 && projection?.commands?.[requestId]?.status !== "complete"; i++) await delay(20);
    assert.equal(projection?.commands?.[requestId]?.status, "complete", JSON.stringify(projection));
  }
  const first = await start();
  await prompt(first.url, "user-a", initial, "first");
  assert.equal(payloads.length, 2);
  const saved = structuredClone(projection);
  first.worker.kill("SIGTERM");
  await once(first.worker, "exit");
  const second = await start();
  await prompt(second.url, "user-a", saved, "second");
  const restored = payloads.at(-1).messages;
  assert.ok(restored.some((m: any) => m.role === "tool" && m.tool_call_id === "tasks-call"), JSON.stringify(restored));
  assert.ok(restored.some((m: any) => m.role === "assistant" && m.content === "第一轮已完成"));
  await prompt(second.url, "user-a", { ...initial, conversationId: "conversation-2" }, "other-conversation", "conversation-2");
  assert.equal(payloads.at(-1).messages.filter((m: any) => m.role === "tool").length, 0);
  await prompt(second.url, "user-b", initial, "other-user");
  assert.equal(payloads.at(-1).messages.filter((m: any) => m.role === "tool").length, 0);
});
