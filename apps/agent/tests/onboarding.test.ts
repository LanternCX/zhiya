import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { Conversation, ConversationStore } from "../src/pi/contracts.ts";
import type { AssistantOutput } from "../src/domain/learning.ts";
import type { ProfileSession as ProfileSessionType } from "../src/pi/sessions/profile.ts";

let directory: string;
let ProfileSession: typeof ProfileSessionType;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "zhiya-onboarding-"));
  await symlink(resolve("../../node_modules"), join(directory, "node_modules"));
  const outfile = join(directory, "profile.mjs");
  await build({ entryPoints: ["src/pi/sessions/profile.ts"], bundle: true, packages: "external", outfile, platform: "node", format: "esm" });
  ({ ProfileSession } = await import(pathToFileURL(outfile).href));
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

function reply(text: string): Response;
function reply(tool: { name: string; arguments: object }): Response;
function reply(value: string | { name: string; arguments: object }) {
  const delta = typeof value === "string"
    ? { role: "assistant", content: value }
    : { role: "assistant", tool_calls: [{ index: 0, id: crypto.randomUUID(), type: "function", function: { name: value.name, arguments: JSON.stringify(value.arguments) } }] };
  const chunk = { id: "reply", object: "chat.completion.chunk", created: 1, model: "test" };
  return new Response(
    `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: typeof value === "string" ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

test("repeated prose stops with a retryable error and a recreated session resumes without inventing an answer", async () => {
  const { state, store, questions } = conversationStore();
  let requests = 0;
  const brokenGateway = {
    onboarding: async () => {
      requests++;
      assert.ok(requests <= 4, "unstructured output must have a finite retry budget");
      return reply("没关系，我们慢慢来。您想学什么？");
    },
    course: async () => { throw new Error("Unexpected course request"); },
  };
  const broken = new ProfileSession(brokenGateway, { id: "test", available: true }, store, () => {}, () => {}, () => {}, "teacher");
  await assert.rejects(broken.run(), /未能生成可回答的问题.*继续交流/);
  assert.equal(state.completed, false);
  assert.deepEqual(questions, []);
  assert.equal(requests, 3);
  const userMessages = state.messages.filter(message => message.role === "user");

  const payloads: any[] = [];
  const restored = new ProfileSession({
    ...brokenGateway,
    onboarding: async (_runId, payload) => {
      payloads.push(payload);
      if (payloads.length === 1)
        return reply({ name: "ask_student", arguments: { text: "你想学习什么？", kind: "text", options: [] } });
      if (payloads.length === 2)
        return reply({ name: "update_memory", arguments: { content: "想学习 Python，先看例子再练习。", version: 0 } });
      return reply({ name: "complete_onboarding", arguments: {} });
    },
  }, { id: "test", available: true }, store, () => {}, () => {}, () => {}, "teacher");
  await restored.run();
  assert.deepEqual(questions, ["你想学习什么？"]);
  assert.equal(state.completed, true);
  assert.deepEqual(state.messages.filter(message => message.role === "user"), userMessages);
  assert.ok(!JSON.stringify(payloads[0].messages).includes("没关系，我们慢慢来"));
});

// The persistence boundary supplies the user's answer, as the server does after submission.
function conversationStore() {
  const state: Conversation = {
    id: "onboarding", purpose: "onboarding", messages: [], question: null,
    completed: false, correctionEnded: false, memory: "", memoryVersion: 0,
    messageSequence: 0, revision: 0, status: "idle", leaseUntil: "",
  };
  const questions: string[] = [];
  const store: ConversationStore = {
    open: async () => structuredClone(state),
    current: async () => structuredClone(state),
    waitForChange: async () => { throw new Error("Unexpected pending question"); },
    claim: async () => ({ runId: "run" }),
    heartbeat: async () => {},
    release: async () => {},
    saveMessage: async (_runId, message) => { state.messages.push(structuredClone(message)); },
    recordToolError: async () => { throw new Error("Unexpected tool error"); },
    executeTool: async (_runId, id) => {
      const call = state.messages.flatMap(message => message.role === "assistant" ? message.content : [])
        .find(block => block.type === "toolCall" && block.id === id);
      assert.ok(call?.type === "toolCall");
      let details: object = {};
      if (call.name === "ask_student") {
        questions.push(call.arguments.text);
        details = { selected: [], text: "想学习 Python，先看例子再练习。", skipped: false };
      } else if (call.name === "update_memory") {
        state.memory = call.arguments.content;
        state.memoryVersion++;
      } else if (call.name === "complete_onboarding") {
        state.completed = true;
      }
      const result: ToolResultMessage = {
        role: "toolResult", toolCallId: id, toolName: call.name,
        content: [{ type: "text", text: JSON.stringify(details) }], details,
        isError: false, timestamp: Date.now(),
      };
      state.messages.push(result);
      return { result };
    },
  };
  return { state, store, questions };
}

test("resuming after a text-only reply preserves submitted answers without asking them again", async () => {
  const { state, store, questions } = conversationStore();
  let requests = 0;
  const gateway = {
    onboarding: async () => {
      requests++;
      if (requests === 1)
        return reply({ name: "ask_student", arguments: { text: "你想学习什么？", kind: "text", options: [] } });
      return reply("我知道了。");
    },
    course: async () => { throw new Error("Unexpected course request"); },
  };
  const first = new ProfileSession(gateway, { id: "test", available: true }, store, () => {}, () => {}, () => {}, "student");
  await assert.rejects(first.run(), /未能生成可回答的问题/);
  const answers = state.messages.filter(message => message.role === "toolResult");
  assert.equal(answers.length, 1);
  const payloads: any[] = [];
  const resumed = new ProfileSession({
    ...gateway,
    onboarding: async (_runId, payload) => {
      payloads.push(payload);
      return payloads.length === 1
        ? reply({ name: "update_memory", arguments: { content: "想学习 Python，先看例子再练习。", version: 0 } })
        : reply({ name: "complete_onboarding", arguments: {} });
    },
  }, { id: "test", available: true }, store, () => {}, () => {}, () => {}, "student");
  await resumed.run();
  assert.equal(payloads[0].tool_choice, "required");
  assert.equal(payloads[0].messages.at(-1).role, "tool");
  assert.ok(JSON.stringify(payloads[0].messages).includes("想学习 Python，先看例子再练习。"));
  assert.deepEqual(questions, ["你想学习什么？"]);
  assert.equal(state.completed, true);
  assert.equal(state.memory, "想学习 Python，先看例子再练习。");
});

for (const role of ["student", "teacher"] as const) {
  test(`${role} onboarding recovers from prose and presents a question before saving and finishing`, async () => {
    const { state, store, questions } = conversationStore();
    const outputs: AssistantOutput[] = [];
    const payloads: any[] = [];
    const session = new ProfileSession({
      onboarding: async (_runId, payload) => {
        payloads.push(payload);
        switch (payloads.length) {
          case 1: return reply("您好！您想学什么？");
          case 2: return reply({ name: "ask_student", arguments: { text: "你想学习什么？", kind: "text", options: [] } });
          case 3: return reply({ name: "update_memory", arguments: { content: "想学习 Python，先看例子再练习。", version: 0 } });
          case 4: return reply({ name: "complete_onboarding", arguments: {} });
          default: return reply("完成了。");
        }
      },
      course: async () => { throw new Error("Unexpected course request"); },
    }, { id: "test", available: true }, store, () => {}, value => outputs.push(value), () => {}, role);
    await session.run();
    assert.deepEqual(questions, ["你想学习什么？"]);
    assert.equal(state.completed, true);
    assert.equal(state.memory, "想学习 Python，先看例子再练习。");
    assert.ok(outputs.every(output => output.text === ""), "prose must never reach the answer UI");
    assert.equal(payloads.length, 4, "completion should stop the model loop");
    assert.deepEqual(payloads[0].tool_choice, { type: "function", function: { name: "ask_student" } });
    assert.equal(payloads[2].tool_choice, "required");
    assert.ok(payloads.every(payload => payload.thinking?.type === "disabled"));
    const resumed = payloads[1].messages;
    assert.equal(resumed.filter((message: any) => message.role === "user").length, 1);
    assert.ok(!JSON.stringify(resumed).includes("您好！您想学什么？"));
  });
}
