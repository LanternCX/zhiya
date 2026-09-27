import { speechSocketURL } from "./voice";

export type SpeechEvent =
  | { type: "ready" }
  | { type: "transcript"; text: string; final: boolean }
  | { type: "complete" }
  | { type: "error"; message: string };

export class SpeechStream {
  private socket: WebSocket | null = null;
  private readonly onEvent: (event: SpeechEvent) => void;

  constructor(onEvent: (event: SpeechEvent) => void) { this.onEvent = onEvent; }

  async connect(): Promise<void> {
    const url = await speechSocketURL("/api/speech/stream");
    const socket = new WebSocket(url);
    socket.onmessage = (message) => {
      let event: SpeechEvent;
      try { event = JSON.parse(message.data) as SpeechEvent; }
      catch { this.onEvent({ type: "error", message: "语音服务返回了无效消息" }); return; }
      this.onEvent(event);
    };
    socket.onerror = () => { if (this.socket === socket) this.onEvent({ type: "error", message: "语音连接失败" }); };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.onEvent({ type: "error", message: "语音识别连接已断开" });
    };
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.addEventListener("error", () => reject(new Error("语音连接失败")), { once: true });
      socket.addEventListener("close", () => reject(new Error("语音识别连接已断开")), { once: true });
    });
  }

  async startAsr() { await this.connect(); this.send({ type: "start" }); }
  sendAudio(audio: ArrayBuffer) { this.socket?.send(audio); }
  stop() { this.send({ type: "stop" }); }
  close() { const socket = this.socket; this.socket = null; socket?.close(); }
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

export function takeCompletedSentences(text: string, consumed: number, flush = false) {
  const result: string[] = []; let cursor = consumed;
  const pattern = /[。！？!?；;\n]/g; let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) { if (match.index + 1 > consumed) { result.push(text.slice(cursor, match.index + 1).trim()); cursor = match.index + 1; } }
  if (flush && cursor < text.length) result.push(text.slice(cursor).trim());
  return { sentences: result.filter(Boolean), consumed: cursor };
}
