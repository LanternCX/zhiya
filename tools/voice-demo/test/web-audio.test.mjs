import test from "node:test";
import assert from "node:assert/strict";

import { encodePcm16, resampleFloat32 } from "../web/audio.mjs";

test("resamples browser audio to 16 kHz", () => {
  const input = new Float32Array(48000);
  input[0] = 1;
  const output = resampleFloat32(input, 48000, 16000);
  assert.equal(output.length, 16000);
  assert.equal(output[0], 1);
});

test("encodes normalized samples as signed 16-bit PCM", () => {
  const pcm = encodePcm16(new Float32Array([-1, 0, 1]));
  assert.equal(pcm.byteLength, 6);
  const view = new DataView(pcm);
  assert.equal(view.getInt16(0, true), -32768);
  assert.equal(view.getInt16(2, true), 0);
  assert.equal(view.getInt16(4, true), 32767);
});
