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
const call = (id: string, name: string, args: object) => completion({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, "tool_calls");

for (const restricted of [false, true]) {
  test(restricted ? "restricted Bilibili searches report a tool error without creating a page" : "Bilibili search stays hidden until selected and the video survives agent restart", { timeout: 20000 }, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "zhiya-bilibili-"));
    let projection: any;
    let turn = 0;
    let searchCount = 0;
    let candidateId = "";
    const video = { bvid: "BV1B7411m7LV", title: "机器学习入门", description: "用例子认识机器学习", author: "老师", duration: "9:50", playCount: 12345, publishedAt: 1584949882 };
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (req.url === "/bilibili/search") {
        searchCount++;
        assert.equal(body.query, "机器学习");
        assert.equal(body.page, 1);
        res.writeHead(restricted ? 503 : 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(restricted ? { error: "B站检索暂时受限，请稍后再试；不要连续重试" } : { page: 1, totalPages: 1, videos: [video] }));
        return;
      }
      if (req.url === "/course/model") {
        turn++;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        if (turn === 1) {
          assert.ok(body.payload.tools.some((tool: any) => tool.function.name === "search_bilibili"));
          res.end(call("search", "search_bilibili", { query: "机器学习" }));
        } else if (turn === 2) {
          const result = body.payload.messages.findLast((m: any) => m.role === "tool");
          if (restricted) {
            assert.match(JSON.stringify(result), /检索暂时受限/);
            res.end(completion({ role: "assistant", content: "B站检索暂时受限。" }, "stop"));
          } else {
            const found = JSON.parse(result.content);
            candidateId = found.videos[0].pageId;
            assert.equal(found.videos[0].playCount, 12345);
            assert.ok(candidateId);
            // The search itself must not append a presentation.
            assert.equal(projection?.lesson.presentations.length ?? 0, 0);
            res.end(call("show", "show_lesson_page", { pageId: candidateId }));
          }
        } else if (turn === 4) {
          res.end(call("show-again", "show_lesson_page", { pageId: candidateId }));
        } else {
          res.end(completion({ role: "assistant", content: "可以在右侧观看视频。" }, "stop"));
        }
        return;
      }
      if (req.url?.endsWith("/state")) projection = body;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(async () => { server.closeAllConnections(); server.close(); await rm(directory, { recursive: true, force: true }); });
    async function start() {
      const worker = spawn(process.execPath, ["dist/server.mjs"], {
        env: { ...process.env, ZHIYA_AGENT_SECRET: "test-secret", ZHIYA_AGENT_API: `http://127.0.0.1:${(server.address() as { port: number }).port}`, ZHIYA_AGENT_LISTEN: "127.0.0.1:0", ZHIYA_AGENT_WORKSPACES: directory },
        stdio: ["ignore", "pipe", "pipe"],
      });
      t.after(() => worker.kill("SIGTERM"));
      const [ready] = await once(worker.stdout, "data");
      const port = String(ready).match(/127\.0\.0\.1:(\d+)/)?.[1];
      assert.ok(port);
      return { worker, url: `http://127.0.0.1:${port}/commands` };
    }
    async function prompt(url: string, state: object, requestId: string) {
      const response = await fetch(url, { method: "POST", headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" }, body: JSON.stringify({ userId: "student", session: { id: "video-session", kind: "course", conversationId: "lesson", state }, grant: "grant", memory: "", model: { id: "test", available: true }, command: { requestId, action: "prompt", args: ["看一个机器学习视频"] } }) });
      assert.equal(response.status, 202, await response.text());
      for (let i = 0; i < 300 && projection?.commands?.[requestId]?.status !== "complete"; i++) await delay(20);
      assert.equal(projection?.commands?.[requestId]?.status, "complete", JSON.stringify(projection));
    }
    const first = await start();
    await prompt(first.url, { course: null, conversationId: "lesson", lesson: { messages: [], pages: [], presentations: [], currentPresentationId: "" }, busy: false, generating: false }, "first");
    assert.equal(searchCount, 1);
    if (restricted) {
      assert.equal(projection.lesson.pages.length, 0);
      assert.equal(projection.lesson.presentations.length, 0);
      return;
    }
    assert.equal(projection.lesson.pages[0].kind, "video");
    assert.equal(projection.lesson.pages[0].bvid, video.bvid);
    assert.equal(projection.lesson.pages[0].topic, "机器学习");
    assert.deepEqual(projection.lesson.presentations, [{ id: "show", pageId: candidateId }]);
    const saved = structuredClone(projection);
    first.worker.kill("SIGTERM");
    await once(first.worker, "exit");
    const second = await start();
    await prompt(second.url, saved, "second");
    assert.equal(searchCount, 1);
    assert.equal(projection.lesson.pages.length, 1);
    assert.equal(projection.lesson.presentations.length, 2);
    assert.equal(projection.lesson.currentPresentationId, "show-again");
  });
}
