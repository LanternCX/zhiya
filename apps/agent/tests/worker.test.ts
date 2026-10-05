import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const chunk = (content: string) =>
  `data: ${JSON.stringify({ id: "response", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`;
const done = `data: ${JSON.stringify({ id: "response", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;

test(
  "server-owned Pi completes after the dispatch connection closes; duplicate delivery does not run twice",
  { timeout: 15000 },
  async (t) => {
    const workspace = await mkdtemp(join(tmpdir(), "zhiya-worker-"));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    let projection: any;
    const payloads: any[] = [];
    let models = 0;
    let release!: () => void;
    let gate = new Promise<void>((resolve) => (release = resolve));
    const api = createServer(async (req, res) => {
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(part);
      if (req.url === "/course/model") {
        models++;
        payloads.push(JSON.parse(Buffer.concat(parts).toString()).payload);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(chunk("开始"));
        await gate;
        res.end(chunk("，生成完成") + done);
        return;
      }
      if (req.url?.endsWith("/state"))
        projection = JSON.parse(Buffer.concat(parts).toString());
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    api.listen(0, "127.0.0.1");
    await once(api, "listening");
    t.after(() => {
      release();
      api.closeAllConnections();
      api.close();
    });
    const port = (api.address() as { port: number }).port;
    const worker = spawn(process.execPath, ["dist/server.mjs"], {
      env: {
        ...process.env,
        ZHIYA_AGENT_WORKSPACES: workspace,
        ZHIYA_AGENT_SECRET: "test-secret",
        ZHIYA_AGENT_API: `http://127.0.0.1:${port}`,
        ZHIYA_AGENT_LISTEN: "127.0.0.1:0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => worker.kill("SIGTERM"));
    let errors = "";
    worker.stderr.on("data", (data) => (errors += data));
    const [ready] = await once(worker.stdout, "data");
    const address = String(ready).match(/127\.0\.0\.1:(\d+)/)?.[1];
    assert.ok(address, errors);
    const url = `http://127.0.0.1:${address}/commands`;
    const input = {
      userId: "test-user",
      session: {
        id: "course-session",
        kind: "course",
        state: {
          course: null,
          conversationId: "conversation-1",
          lesson: {
            messages: [],
            pages: [],
            presentations: [],
            currentPresentationId: "",
          },
          busy: true,
          running: true,
          generating: true,
          activity: { kind: "thinking", text: "interrupted", active: true },
          commands: { interrupted: { status: "running" } },
        },
      },
      grant: "test-grant",
      memory: "",
      model: { id: "test", available: true },
      command: {
        requestId: "message-1",
        action: "prompt",
        args: ["  解释一下  ", ["notes.md"], "speech"],
      },
    };
    const dispatch = () =>
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
          Connection: "close",
        },
        body: JSON.stringify(input),
      });
    const prompt = input.command;
    input.command = { requestId: "reattach", action: "attach", args: [] };
    assert.equal((await dispatch()).status, 202);
    for (let i = 0; i < 200 && projection?.commands?.reattach?.status !== "complete"; i++) await delay(25);
    assert.equal(projection.commands.reattach.status, "complete");
    assert.equal(projection.running, false);
    assert.equal(projection.generating, false);
    assert.equal(projection.activity, null);
    assert.equal(projection.commands.interrupted.status, "failed");
    input.command = prompt;
    const accepted = await Promise.all([dispatch(), dispatch()]);
    for (const response of accepted) assert.equal(response.status, 202);
    // Both HTTP connections have closed while the independent model request remains open.
    release();
    for (
      let i = 0;
      i < 200 && projection?.commands?.["message-1"]?.status === "running";
      i++
    )
      await delay(25);
    assert.equal(
      projection.commands["message-1"].status,
      "complete",
      JSON.stringify(projection) + errors,
    );
    assert.equal(models, 1);
    assert.deepEqual(projection.lesson.messages[0], {
      id: 1,
      role: "user",
      text: "解释一下",
      input_mode: "speech",
      materials: ["notes.md"],
    });
    const speechRequest = JSON.stringify(payloads[0].messages.at(-1));
    assert.match(speechRequest, /自然、简洁、口语化/);
    assert.match(speechRequest, /不要逐字朗读代码/);
    assert.match(speechRequest, /notes\.md/);
    assert.match(JSON.stringify(projection.lesson.messages), /生成完成/);
    assert.equal(projection.busy, false);
    gate = new Promise<void>((resolve) => (release = resolve));
    input.command = {
      requestId: "message-2",
      action: "prompt",
      args: ["再解释一次"],
    };
    assert.equal((await dispatch()).status, 202);
    for (let i = 0; i < 200 && models < 2; i++) await delay(25);
    assert.equal(models, 2);
    const textRequest = JSON.stringify(payloads[1].messages.at(-1));
    assert.match(textRequest, /普通文字模式/);
    assert.match(textRequest, /不要因为历史语音对话而刻意口语化/);
    input.command = { requestId: "stop-2", action: "stop", args: [] };
    assert.equal((await dispatch()).status, 202);
    for (
      let i = 0;
      i < 200 &&
      (projection.busy || projection.commands["stop-2"]?.status !== "complete");
      i++
    )
      await delay(25);
    assert.equal(projection.busy, false);
    assert.equal(projection.commands["stop-2"].status, "complete");
    release();
    await delay(50);
    assert.doesNotMatch(
      projection.lesson.messages
        .filter((message: any) => message.role === "assistant")
        .at(-1).text,
      /生成完成/,
    );
    const forbidden = await fetch(url, {
      method: "POST",
      body: JSON.stringify(input),
    });
    assert.equal(forbidden.status, 401);
  },
);
