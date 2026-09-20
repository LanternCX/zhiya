export type SpeechEvent =
  | { type: "ready" }
  | { type: "transcript"; text: string; final: boolean }
  | { type: "audio"; data: string; sampleRate: number }
  | { type: "complete" }
  | { type: "error"; message: string };

export class SpeechStream {
  private socket: WebSocket | null = null;
  private readonly onEvent: (event: SpeechEvent) => void;

  constructor(onEvent: (event: SpeechEvent) => void) { this.onEvent = onEvent; }

  async connect(): Promise<void> {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/api/speech/stream`);
    socket.onmessage = (message) => {
      try { this.onEvent(JSON.parse(message.data) as SpeechEvent); }
      catch { this.onEvent({ type: "error", message: "语音服务返回了无效消息" }); }
    };
    socket.onerror = () => this.onEvent({ type: "error", message: "语音连接失败" });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.addEventListener("error", () => reject(new Error("语音连接失败")), { once: true });
    });
  }

  async startAsr() { await this.connect(); this.send({ type: "start" }); }
  startTts(text: string) { this.send({ type: "tts-start", text }); }
  sendAudio(audio: ArrayBuffer) { this.socket?.send(audio); }
  stop() { this.send({ type: "stop" }); }
  stopTts() { this.send({ type: "tts-stop" }); }
  close() { this.socket?.close(); this.socket = null; }
  private send(value: object) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value)); }
}

export function float32ToPcm16(input: Float32Array, sourceRate: number, targetRate = 16000): ArrayBuffer {
  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new ArrayBuffer(length * 2);
  const view = new DataView(output);
  for (let i = 0; i < length; i++) {
    const sample = input[Math.min(input.length - 1, Math.floor(i * ratio))];
    view.setInt16(i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  }
  return output;
}
