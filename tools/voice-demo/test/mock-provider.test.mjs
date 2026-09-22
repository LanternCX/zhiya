import test from "node:test";
import assert from "node:assert/strict";

import { createMockProvider } from "../src/providers/mock.mjs";

test("mock provider returns deterministic ASR and TTS events", async () => {
  const provider = createMockProvider({
    transcript: "你好世界",
    audioDurationMs: 320,
  });

  const asr = await provider.transcribe(Buffer.from("audio"), { reference: "你好世界" });
  const tts = await provider.synthesize("你好世界");

  assert.equal(asr.text, "你好世界");
  assert.equal(asr.packets.length, 2);
  assert.equal(tts.audio.length, 320);
  assert.equal(tts.sampleRate, 16000);
});
