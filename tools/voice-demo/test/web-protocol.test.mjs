import test from "node:test";
import assert from "node:assert/strict";

import { buildRunTask, buildTtsSession, mapQwenAsrEvent, mapQwenTtsEvent } from "../web/protocol.mjs";

test("builds a streaming ASR task for 16 kHz PCM", () => {
  const message = buildRunTask("task-1");
  assert.equal(message.payload.model, "qwen-audio-3.0-asr-flash-streaming");
  assert.deepEqual(message.payload.parameters, { format: "pcm", sample_rate: 16000 });
  assert.equal(message.header.streaming, "duplex");
});

test("maps a Qwen sentence event to a browser transcript", () => {
  assert.deepEqual(mapQwenAsrEvent({
    header: { event: "result-generated" },
    payload: { output: { sentence: { text: "你好知芽", sentence_end: true } } },
  }), { type: "transcript", text: "你好知芽", final: true });
});

test("maps a failed Qwen task to a safe browser error", () => {
  assert.deepEqual(mapQwenAsrEvent({
    header: { event: "task-failed", error_code: "InvalidParameter", error_message: "bad audio" },
  }), { type: "error", message: "InvalidParameter: bad audio" });
});

test("builds a realtime Qwen TTS session", () => {
  const message = buildTtsSession("Cherry");
  assert.equal(message.type, "session.update");
  assert.equal(message.session.voice, "Cherry");
  assert.equal(message.session.sample_rate, 24000);
  assert.equal(message.session.response_format, "pcm");
});

test("maps streamed Qwen TTS audio and completion events", () => {
  assert.deepEqual(mapQwenTtsEvent({ type: "response.audio.delta", delta: "AQI=" }), { type: "audio", data: "AQI=", sampleRate: 24000 });
  assert.deepEqual(mapQwenTtsEvent({ type: "response.audio.done" }), { type: "complete" });
});
