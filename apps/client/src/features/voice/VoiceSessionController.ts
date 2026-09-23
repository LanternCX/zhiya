import { MicrophoneCapture } from "./MicrophoneCapture";
import { isVoiceServerEvent, type VoiceServerEvent } from "./protocol";
import { initialVoiceState, voiceReducer, type VoiceAction } from "./voice-reducer";
import type { VoiceState } from "./types";

export class VoiceSessionController {
  private socket: WebSocket | null = null;
  private capture: MicrophoneCapture | null = null;
  private sessionId = crypto.randomUUID();
  private turnId = 0;
  private state: VoiceState = initialVoiceState;
  private readonly listeners = new Set<(state: VoiceState) => void>();
  private readonly onTranscript: (text: string, final: boolean) => void;

  constructor(onTranscript: (text: string, final: boolean) => void = () => undefined) { this.onTranscript = onTranscript; }
  subscribe(listener: (state: VoiceState) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getState() { return this.state; }

  async start() {
    this.dispatch({ type: "connect", sessionId: this.sessionId });
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/api/voice/session`);
    this.socket = socket;
    socket.onmessage = (message) => this.handleMessage(message.data);
    socket.onerror = () => this.dispatch({ type: "error", message: "语音连接失败" });
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.addEventListener("error", () => reject(new Error("语音连接失败")), { once: true });
    });
    this.send({ type: "start-session", sessionId: this.sessionId, turnId: this.turnId });
    this.capture = new MicrophoneCapture({
      onPcm: (pcm) => socket.readyState === WebSocket.OPEN && socket.send(pcm),
      onVadEvent: (event) => {
        if (event.kind === "speech-start") this.dispatch({ type: "speech-started" });
        if (event.kind === "speech-end") this.commitTurn();
      },
    });
    await this.capture.start();
  }

  commitTurn() { this.dispatch({ type: "commit" }); this.send({ type: "commit-turn", sessionId: this.sessionId, turnId: this.turnId }); }
  setMuted(muted: boolean) { muted ? this.capture?.mute() : this.capture?.unmute(); this.send({ type: muted ? "mute" : "unmute", sessionId: this.sessionId, turnId: this.turnId }); this.dispatch({ type: muted ? "mute" : "unmute" }); }
  interrupt() { this.send({ type: "cancel-tts", sessionId: this.sessionId, turnId: this.turnId }); this.turnId += 1; this.dispatch({ type: "ready" }); }
  end() { this.capture?.stop(); this.capture = null; this.send({ type: "end-session", sessionId: this.sessionId, turnId: this.turnId }); this.socket?.close(); this.socket = null; this.dispatch({ type: "end" }); }

  private handleMessage(raw: unknown) {
    let value: unknown;
    try { value = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { this.dispatch({ type: "error", message: "语音服务返回了无效消息" }); return; }
    if (!isVoiceServerEvent(value)) return;
    const event = value as VoiceServerEvent;
    if (event.sessionId !== this.sessionId || event.turnId < this.turnId) return;
    if (event.type === "session-ready") this.dispatch({ type: "ready" });
    if (event.type === "transcript-delta" || event.type === "transcript-final") { const text = event.text ?? ""; this.dispatch({ type: "transcript", turnId: event.turnId, text, final: event.type === "transcript-final" }); this.onTranscript(text, event.type === "transcript-final"); }
    if (event.type === "tts-audio") this.dispatch({ type: "speaking" });
    if (event.type === "session-error") this.dispatch({ type: "error", message: event.message ?? "语音会话失败" });
    if (event.type === "session-ended") this.dispatch({ type: "end" });
  }
  private send(value: object) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value)); }
  private dispatch(action: VoiceAction) { this.state = voiceReducer(this.state, action); this.listeners.forEach((listener) => listener(this.state)); }
}
