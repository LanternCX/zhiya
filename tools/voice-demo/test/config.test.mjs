import test from "node:test";
import assert from "node:assert/strict";

import { readConfig } from "../src/config.mjs";

test("reads provider and input settings from environment", () => {
  const config = readConfig({
    VOICE_PROVIDER: "mock",
    VOICE_MODE: "asr",
    VOICE_AUDIO: "fixtures/hello.wav",
    VOICE_REFERENCE: "你好世界",
  });

  assert.deepEqual(config, {
    provider: "mock",
    mode: "asr",
    audioPath: "fixtures/hello.wav",
    outputPath: "tools/voice-demo/output.wav",
    text: "你好世界",
    reference: "你好世界",
    apiKey: "",
    endpoint: "",
    model: "",
  });
});

test("rejects unsupported provider", () => {
  assert.throws(() => readConfig({ VOICE_PROVIDER: "unknown" }), /Unsupported provider/);
});

test("accepts roundtrip mode", () => {
  assert.equal(readConfig({ VOICE_MODE: "roundtrip" }).mode, "roundtrip");
});
