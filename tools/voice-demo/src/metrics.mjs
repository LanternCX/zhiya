export function normalizeTranscript(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s\u3000，。！？、；：,.!?;:'"“”‘’（）()【】\[\]{}<>《》]/g, "");
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function calculateMetrics({ reference = "", hypothesis = "", startedAt, firstPartialAt, speechEndedAt, finalAt, packets = [] }) {
  const expected = normalizeTranscript(reference);
  const actual = normalizeTranscript(hypothesis);
  return {
    cer: expected ? levenshtein(expected, actual) / expected.length : null,
    firstPartialLatencyMs: firstPartialAt == null || startedAt == null ? null : firstPartialAt - startedAt,
    finalLatencyMs: finalAt == null || speechEndedAt == null ? null : finalAt - speechEndedAt,
    partialRevisionCount: Math.max(0, packets.length - 1),
    packetCount: packets.length,
  };
}

export function summarizeTts({ startedAt, firstAudioAt, finishedAt, audioDurationMs = 0 }) {
  return {
    firstAudioLatencyMs: firstAudioAt == null ? null : firstAudioAt - startedAt,
    synthesisDurationMs: finishedAt == null ? null : finishedAt - startedAt,
    audioDurationMs,
    realtimeFactor: finishedAt == null || !audioDurationMs ? null : (finishedAt - startedAt) / audioDurationMs,
  };
}
