import { readFile, writeFile } from "node:fs/promises";
import { readConfig } from "./config.mjs";
import { calculateMetrics, summarizeTts } from "./metrics.mjs";
import { createProvider } from "./providers/index.mjs";
import { decodeWav, encodeWav, resamplePcm16Mono } from "./wav.mjs";

const config = readConfig();
const provider = createProvider(config);
const startedAt = Date.now();

if (config.mode === "asr" || config.mode === "roundtrip") {
  let audio = config.audioPath ? await readFile(config.audioPath) : Buffer.from("demo-audio");
  let sampleRate = 16000;
  if (config.mode === "roundtrip") {
    const decoded = decodeWav(await readFile(config.audioPath || config.outputPath));
    sampleRate = 16000;
    audio = resamplePcm16Mono(decoded.pcm, decoded.sampleRate, sampleRate);
  }
  const result = await provider.transcribe(audio, { reference: config.reference, sampleRate });
  const now = Date.now();
  const metrics = calculateMetrics({ reference: config.reference, hypothesis: result.text, startedAt, firstPartialAt: startedAt, speechEndedAt: startedAt, finalAt: now, packets: result.packets });
  console.log(JSON.stringify({ provider: config.provider, mode: config.mode, reference: config.reference, text: result.text, exactMatch: metrics.cer === 0, metrics }, null, 2));
} else {
  const result = await provider.synthesize(config.text);
  await writeFile(config.outputPath, encodeWav(result.audio, result.sampleRate));
  const now = Date.now();
  const metrics = summarizeTts({ startedAt, firstAudioAt: startedAt, finishedAt: now, audioDurationMs: result.audio.length });
  console.log(JSON.stringify({ provider: config.provider, mode: "tts", text: config.text, sampleRate: result.sampleRate, outputPath: config.outputPath, audioBytes: result.audio.length, metrics }, null, 2));
}
