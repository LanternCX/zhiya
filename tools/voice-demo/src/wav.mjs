export function encodeWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function decodeWav(wav) {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected a RIFF/WAVE file");
  }
  let offset = 12;
  let format;
  let pcm;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      format = {
        encoding: wav.readUInt16LE(start),
        channels: wav.readUInt16LE(start + 2),
        sampleRate: wav.readUInt32LE(start + 4),
        bitsPerSample: wav.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      pcm = wav.subarray(start, Math.min(start + size, wav.length));
    }
    offset = start + size + (size % 2);
  }
  if (!format || !pcm) throw new Error("WAV is missing fmt or data chunk");
  if (format.encoding !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new Error("Only 16-bit mono PCM WAV is supported");
  }
  return { ...format, pcm };
}

export function resamplePcm16Mono(pcm, sourceRate, targetRate) {
  if (sourceRate === targetRate) return pcm;
  const sourceSamples = pcm.length / 2;
  const targetSamples = Math.floor(sourceSamples * targetRate / sourceRate);
  const result = Buffer.alloc(targetSamples * 2);
  for (let i = 0; i < targetSamples; i += 1) {
    const sourceIndex = Math.min(sourceSamples - 1, Math.floor(i * sourceRate / targetRate));
    result.writeInt16LE(pcm.readInt16LE(sourceIndex * 2), i * 2);
  }
  return result;
}
