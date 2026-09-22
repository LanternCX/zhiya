import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { buildFinishTask, receiveUntil } from "../src/providers/qwen.mjs";

test("builds a protocol-compliant finish-task event", () => {
  assert.deepEqual(buildFinishTask("task-1"), {
    header: { action: "finish-task", task_id: "task-1", streaming: "duplex" },
    payload: { input: {} },
  });
});

test("reports a Qwen task failure instead of leaving the request pending", async () => {
  const ws = new EventEmitter();
  const pending = receiveUntil(ws, () => {});
  ws.emit("message", Buffer.from(JSON.stringify({
    header: { event: "task-failed", error_code: "InvalidParameter", error_message: "bad audio" },
  })));
  await assert.rejects(pending, /InvalidParameter: bad audio/);
});

test("reports an early WebSocket close", async () => {
  const ws = new EventEmitter();
  const pending = receiveUntil(ws, () => {});
  ws.emit("close", 1006, Buffer.from("abnormal close"));
  await assert.rejects(pending, /closed before completion.*1006.*abnormal close/);
});
