import { MicrophoneCapture } from "./MicrophoneCapture";
import { TranscriptAccumulator } from "./TranscriptAccumulator";
import { PlaybackController } from "./PlaybackController";
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
  private readonly playback = new PlaybackController();
  private speakerEnabled = true;
  private speechQueue: string[] = [];
  private speechInFlight = false;
  private readonly transcript = new TranscriptAccumulator();
  private readonly onInterruptAgent: () => void;
  private sessionReady: Promise<void> | null = null;
  private resolveSessionReady: (() => void) | null = null;
  private rejectSessionReady: ((reason: Error) => void) | null = null;

  constructor(onTranscript: (text: string, final: boolean) => void = () => undefined, onInterruptAgent: () => void = () => undefined) { this.onTranscript = onTranscript; this.onInterruptAgent = onInterruptAgent; }
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
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error("语音连接超时，请检查后端服务和 ASR API Key"));
      }, 10_000);
      socket.onopen = () => { window.clearTimeout(timeout); resolve(); };
      socket.addEventListener("error", () => { window.clearTimeout(timeout); reject(new Error("语音连接失败，请检查后端服务和 ASR API Key")); }, { once: true });
    });
    this.sessionReady = new Promise<void>((resolve, reject) => {
      this.resolveSessionReady = resolve;
      this.rejectSessionReady = reject;
    });
    this.send({ type: "start-session", sessionId: this.sessionId, turnId: this.turnId });
    try {
      await this.sessionReady;
    } catch (error) {
      this.capture?.stop();
      this.capture = null;
      this.socket?.close();
      this.socket = null;
      throw error;
    } finally {
      this.sessionReady = null;
      this.resolveSessionReady = null;
      this.rejectSessionReady = null;
    }
    this.capture = new MicrophoneCapture({
      onPcm: (pcm) => socket.readyState === WebSocket.OPEN && socket.send(pcm),
      onVadEvent: (event) => {
        this.dispatch({ type: "level", value: Math.min(1, event.level * 3) });
        if (event.kind === "speech-start") {
          this.transcript.reset();
          if (this.state.status === "speaking" || this.state.status === "thinking") this.interrupt();
          this.dispatch({ type: "speech-started" });
        }
        if (event.kind === "speech-end") this.commitTurn();
      },
    });
    await this.capture.start();
  }

  commitTurn() { this.dispatch({ type: "commit" }); this.send({ type: "commit-turn", sessionId: this.sessionId, turnId: this.turnId }); }
  speakText(text: string) {
    const normalized = text.trim();
    if (!normalized || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.speechQueue.push(normalized);
    this.pumpSpeechQueue();
  }
  setMuted(muted: boolean) { muted ? this.capture?.mute() : this.capture?.unmute(); this.send({ type: muted ? "mute" : "unmute", sessionId: this.sessionId, turnId: this.turnId }); this.dispatch({ type: muted ? "mute" : "unmute" }); }
  setSpeaker(enabled: boolean) { this.speakerEnabled = enabled; if (!enabled) this.stopPlayback(); }
  interrupt() { this.onInterruptAgent(); this.speechQueue = []; this.speechInFlight = false; this.send({ type: "cancel-tts", sessionId: this.sessionId, turnId: this.turnId }); this.stopPlayback(); this.turnId += 1; this.dispatch({ type: "ready" }); }
  end() { this.rejectSessionReady?.(new Error("语音会话已结束")); this.capture?.stop(); this.capture = null; this.speechQueue = []; this.speechInFlight = false; this.stopPlayback(); this.send({ type: "end-session", sessionId: this.sessionId, turnId: this.turnId }); this.socket?.close(); this.socket = null; this.dispatch({ type: "end" }); }

  private handleMessage(raw: unknown) {
    let value: unknown;
    try { value = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { this.dispatch({ type: "error", message: "语音服务返回了无效消息" }); return; }
    if (!isVoiceServerEvent(value)) return;
    const event = value as VoiceServerEvent;
    if (event.sessionId !== this.sessionId || event.turnId < this.turnId) return;
    if (event.type === "session-ready") { this.resolveSessionReady?.(); this.dispatch({ type: "ready" }); }
    if (event.type === "transcript-delta" || event.type === "transcript-final") {
      const accepted = this.transcript.accept(event.text ?? "", event.type === "transcript-final");
      this.dispatch({ type: "transcript", turnId: event.turnId, text: accepted.text, final: accepted.final });
      if (!accepted.final || accepted.submit) this.onTranscript(accepted.text, accepted.final);
    }
    if (event.type === "tts-audio") { this.dispatch({ type: "speaking" }); if (this.speakerEnabled && event.data) this.playback.enqueue(event.data, event.sampleRate ?? 24000); }
    if (event.type === "tts-complete") { this.speechInFlight = false; this.pumpSpeechQueue(); }
    if (event.type === "session-error") { const message = event.message ?? "语音会话失败"; this.rejectSessionReady?.(new Error(message)); this.dispatch({ type: "error", message }); }
    if (event.type === "session-ended") this.dispatch({ type: "end" });
  }
  private send(value: object) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value)); }
  private pumpSpeechQueue() {
    if (this.speechInFlight || !this.speechQueue.length || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const text = this.speechQueue.shift();
    if (!text) return;
    this.speechInFlight = true;
    this.send({ type: "speak-text", sessionId: this.sessionId, turnId: this.turnId, text });
  }
  private dispatch(action: VoiceAction) { this.state = voiceReducer(this.state, action); this.listeners.forEach((listener) => listener(this.state)); }
  private stopPlayback() { this.playback.clear(); }
}
