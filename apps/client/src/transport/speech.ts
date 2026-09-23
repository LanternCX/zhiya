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
    const session = await fetch("/api/me", { credentials: "include" });
    if (session.status === 401) throw new Error("登录已失效，请重新登录");
    if (!session.ok) throw new Error(`语音服务检查失败（HTTP ${session.status}）`);
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

export class NarrationPlayer {
  private stream: SpeechStream | null = null;
  private context: AudioContext | null = null;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private readonly onIdle: () => void;
  private queue: string[] = [];
  private busy = false;

  constructor(onIdle: () => void) { this.onIdle = onIdle; }
  async speak(text: string) {
    if (!text.trim()) return;
    if (!this.stream) {
      this.stream = new SpeechStream((event) => {
        if (event.type === "audio") this.enqueue(event.data, event.sampleRate);
        if (event.type === "complete") { this.busy = false; void this.pump(); }
      });
      await this.stream.connect();
    }
    this.queue.push(text); await this.pump();
  }
  stop() {
    this.stream?.stopTts(); this.stream?.close(); this.stream = null;
    this.queue = []; this.busy = false;
    for (const source of this.sources) source.stop();
    this.sources.clear(); this.nextTime = 0;
    this.onIdle();
  }
  private async pump() {
    if (this.busy || !this.queue.length || !this.stream) { if (!this.busy && !this.queue.length && !this.sources.size) this.onIdle(); return; }
    this.busy = true; this.stream.startTts(this.queue.shift()!);
  }
  private enqueue(encoded: string, sampleRate: number) {
    const context = this.context ??= new AudioContext();
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const buffer = context.createBuffer(1, Math.floor(bytes.byteLength / 2), sampleRate);
    const channel = buffer.getChannelData(0); const view = new DataView(bytes.buffer);
    for (let index = 0; index < channel.length; index++) channel[index] = view.getInt16(index * 2, true) / 0x8000;
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    this.sources.add(source); const start = Math.max(context.currentTime, this.nextTime); this.nextTime = start + buffer.duration;
    source.onended = () => { this.sources.delete(source); if (!this.sources.size) { this.nextTime = 0; this.onIdle(); } };
    source.start(start);
  }
}

export function takeCompletedSentences(text: string, consumed: number, flush = false) {
  const result: string[] = []; let cursor = consumed;
  const pattern = /[。！？!?；;\n]/g; let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) { if (match.index + 1 > consumed) { result.push(text.slice(cursor, match.index + 1).trim()); cursor = match.index + 1; } }
  if (flush && cursor < text.length) result.push(text.slice(cursor).trim());
  return { sentences: result.filter(Boolean), consumed: cursor };
}
