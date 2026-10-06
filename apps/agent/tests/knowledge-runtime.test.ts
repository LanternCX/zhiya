import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function stream(delta: object, reason: string) {
  return `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`;
}
function call(id: string, name: string, args: object) {
  return stream(
    {
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    },
    "tool_calls",
  );
}

test(
  "the teaching runtime publishes search progress and saves evidence with the answer",
  { timeout: 20000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "zhiya-knowledge-runtime-"));
    const version = "b".repeat(64),
      blockId = "doc-page-1";
    const citation = `[人工智能教材](#knowledge/${version}/${blockId})`;
    const source = {
      version,
      blockId,
      documentId: "doc",
      title: "人工智能教材",
      modality: "image",
      location: { page: 1 },
      text: "训练数据用于模型学习。",
      reviewStatus: "unreviewed",
      warnings: [],
      citation,
      score: 0.9,
      hasAsset: true,
    };
    let turn = 0;
    let projection: any;
    let running = false;
    let read = false;
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (req.url === "/knowledge/search") {
        assert.equal(body.query, "训练数据");
        await delay(150);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ query: body.query, sources: [source] }));
        return;
      }
      if (req.url === `/knowledge/${version}/blocks/${blockId}`) {
        read = true;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ...source,
            visual: {
              transcription: "训练样本",
              description: "标注样本示意",
              warnings: [],
            },
          }),
        );
        return;
      }
      if (req.url === "/course/model") {
        turn++;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        if (turn === 1) {
          assert.ok(
            body.payload.tools.some(
              (tool: any) => tool.function.name === "search_knowledge",
            ),
          );
          res.end(call("search", "search_knowledge", { query: "训练数据" }));
        } else if (turn === 2) {
          res.end(call("read", "read_knowledge_block", { version, blockId }));
        } else {
          assert.equal(read, true);
          res.end(
            stream(
              {
                role: "assistant",
                content: `训练数据是供模型学习的样本。${citation}`,
              },
              "stop",
            ),
          );
        }
        return;
      }
      if (req.url?.endsWith("/state")) {
        projection = body;
        if (
          body.activity?.kind === "knowledge" &&
          body.activity.searches[0].status === "running"
        )
          running = true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(async () => {
      server.closeAllConnections();
      server.close();
      await rm(directory, { recursive: true, force: true });
    });
    const worker = spawn(process.execPath, ["dist/server.mjs"], {
      env: {
        ...process.env,
        ZHIYA_AGENT_SECRET: "test-secret",
        ZHIYA_AGENT_API: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        ZHIYA_AGENT_LISTEN: "127.0.0.1:0",
        ZHIYA_AGENT_WORKSPACES: directory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => worker.kill("SIGTERM"));
    const [ready] = await once(worker.stdout, "data");
    const port = String(ready).match(/127\.0\.0\.1:(\d+)/)?.[1];
    assert.ok(port);
    const response = await fetch(`http://127.0.0.1:${port}/commands`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: "student",
        session: {
          id: "knowledge-session",
          kind: "course",
          conversationId: "lesson",
          state: {
            course: null,
            conversationId: "lesson",
            lesson: {
              messages: [],
              pages: [],
              presentations: [],
              currentPresentationId: "",
            },
            busy: false,
            generating: false,
          },
        },
        grant: "grant",
        memory: "",
        model: { id: "test", available: true },
        command: {
          requestId: "first",
          action: "prompt",
          args: ["训练数据是什么"],
        },
      }),
    });
    assert.equal(response.status, 202, await response.text());
    for (
      let i = 0;
      i < 300 && projection?.commands?.first?.status !== "complete";
      i++
    )
      await delay(20);
    assert.equal(projection?.commands?.first?.status, "complete");
    assert.equal(running, true);
    const answer = projection.lesson.messages.findLast(
      (message: any) => message.role === "assistant",
    );
    assert.match(answer.text, /#knowledge\//);
    assert.equal(answer.knowledgeSearches[0].query, "训练数据");
    assert.equal(answer.knowledgeSearches[0].sources[0].blockId, blockId);
  },
);
