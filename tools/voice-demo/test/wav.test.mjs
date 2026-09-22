import test from "node:test";
import assert from "node:assert/strict";

import { decodeWav, encodeWav, resamplePcm16Mono } from "../src/wav.mjs";

test("encodes mono PCM as a playable WAV buffer", () => {
  const wav = encodeWav(Buffer.from([0, 1, 2, 3]), 16000);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.length, 48);
});

test("resamples mono PCM to the requested sample rate", () => {
  const pcm = Buffer.alloc(48000);
  const result = resamplePcm16Mono(pcm, 24000, 16000);
  assert.equal(result.length, 32000);
});

test("decodes PCM data and format from a WAV buffer", () => {
  const pcm = Buffer.from([0, 1, 2, 3]);
  const decoded = decodeWav(encodeWav(pcm, 24000));
  assert.deepEqual(decoded.pcm, pcm);
  assert.equal(decoded.sampleRate, 24000);
  assert.equal(decoded.channels, 1);
  assert.equal(decoded.bitsPerSample, 16);
});
