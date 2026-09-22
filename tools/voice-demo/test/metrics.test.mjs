import test from "node:test";
import assert from "node:assert/strict";

import { calculateMetrics, normalizeTranscript } from "../src/metrics.mjs";

test("normalizes Chinese transcript whitespace and punctuation", () => {
  assert.equal(normalizeTranscript("  你好，世界！\n"), "你好世界");
});

test("calculates CER and streaming latency from a completed run", () => {
  const metrics = calculateMetrics({
    reference: "你好世界",
    hypothesis: "你好世届",
    startedAt: 1000,
    firstPartialAt: 1250,
    speechEndedAt: 3000,
    finalAt: 3450,
    packets: [
      { at: 1250, text: "你好" },
      { at: 2200, text: "你好世届" },
    ],
  });

  assert.equal(metrics.cer, 0.25);
  assert.equal(metrics.firstPartialLatencyMs, 250);
  assert.equal(metrics.finalLatencyMs, 450);
  assert.equal(metrics.partialRevisionCount, 1);
});
