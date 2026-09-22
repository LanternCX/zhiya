export function resampleFloat32(input, sourceRate, targetRate) {
  if (sourceRate === targetRate) return input;
  const length = Math.floor(input.length * targetRate / sourceRate);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const sourceIndex = Math.min(input.length - 1, Math.floor(index * sourceRate / targetRate));
    output[index] = input[sourceIndex];
  }
  return output;
}

export function encodePcm16(input) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return buffer;
}
