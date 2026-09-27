import { float32ToPcm16, SpeechStream, type SpeechEvent } from "../../transport/speech";

export type VoiceInputStatus = "idle" | "connecting" | "listening" | "finishing" | "paused";

const utterancePauseMs = 1200;

export class VoiceInputController {
  private generation = 0;
  private status: VoiceInputStatus = "idle";
  private speech: SpeechStream | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private finalTimer: number | null = null;
  private completionTimer: number | null = null;
  private readyTimer: number | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private committed = "";
  private transcript = "";
  private heardSound = false;
  private lastSoundAt = 0;

  constructor(
    private readonly onUtterance: (text: string) => void,
    private readonly onStatus: (status: VoiceInputStatus, transcript: string) => void,
    private readonly onError: (message: string) => void,
    private readonly options: { autoSegment?: boolean; onLevel?: (level: number) => void } = {},
  ) {}

  getStatus() { return this.status; }

  async start() {
    if (this.status === "connecting" || this.status === "listening" || this.status === "finishing") return;
    const generation = ++this.generation;
    this.committed = "";
    this.transcript = "";
    this.heardSound = false;
    this.lastSoundAt = 0;
    this.setStatus("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      const speech = new SpeechStream((event) => this.handleEvent(generation, event));
      this.speech = speech;
      const ready = new Promise<void>((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
      this.readyTimer = window.setTimeout(() => this.rejectReady?.(new Error("语音识别连接超时")), 8000);
      await Promise.all([speech.startAsr(), ready]);
      if (generation !== this.generation) return;
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      if (generation !== this.generation) return;
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      this.source = source;
      this.processor = processor;
      processor.onaudioprocess = (event) => {
        if (generation !== this.generation || this.status !== "listening") return;
        const samples = event.inputBuffer.getChannelData(0);
        speech.sendAudio(float32ToPcm16(samples, context.sampleRate));
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        const level = Math.sqrt(energy / samples.length);
        this.options.onLevel?.(Math.min(1, level * 5.5));
        if (this.options.autoSegment === false) return;
        if (level > 0.025) {
          this.heardSound = true;
          this.lastSoundAt = performance.now();
          this.clearFinalTimer();
        } else if (this.heardSound && this.transcript && performance.now() - this.lastSoundAt > utterancePauseMs) {
          this.finish();
        }
      };
      source.connect(processor);
      processor.connect(context.destination);
      this.setStatus("listening");
    } catch (error) {
      if (generation !== this.generation) return;
      const message = error instanceof Error ? error.message : "无法启动语音识别";
      this.pause();
      this.onError(message);
    }
  }

  pause() {
    this.generation += 1;
    this.clearTimers();
    this.rejectReady?.(new Error("语音识别已停止"));
    this.resolveReady = null;
    this.rejectReady = null;
    this.releaseCapture();
    this.speech?.close();
    this.speech = null;
    this.committed = "";
    this.transcript = "";
    this.options.onLevel?.(0);
    this.setStatus("paused");
  }

  stop() { this.finish(); }

  end() {
    this.pause();
    this.setStatus("idle");
  }

  private finish() {
    if (this.status !== "listening") return;
    this.clearFinalTimer();
    this.releaseCapture();
    this.options.onLevel?.(0);
    this.setStatus("finishing");
    const generation = this.generation;
    this.completionTimer = window.setTimeout(() => this.complete(generation), 5000);
    this.speech?.stop();
  }

  private complete(generation: number) {
    if (generation !== this.generation || this.status !== "finishing") return;
    const text = this.transcript.trim();
    this.clearTimers();
    this.speech?.close();
    this.speech = null;
    this.setStatus("paused");
    this.onUtterance(text);
  }

  private handleEvent(generation: number, event: SpeechEvent) {
    if (generation !== this.generation) return;
    if (event.type === "ready") {
      this.clearReadyTimer();
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
    }
    if (event.type === "transcript") {
      const text = event.text.trim();
      if (!text) return;
      if (event.final) {
        if (text.startsWith(this.committed)) this.committed = text;
        else if (!this.committed.endsWith(text)) this.committed += text;
        this.transcript = this.committed;
      } else {
        this.transcript = `${this.committed}${text}`;
      }
      this.onStatus(this.status, this.transcript);
      this.clearFinalTimer();
      if (event.final && this.status === "listening" && this.options.autoSegment !== false)
        this.finalTimer = window.setTimeout(() => this.finish(), utterancePauseMs);
    }
    if (event.type === "complete") this.complete(generation);
    if (event.type === "error") {
      this.rejectReady?.(new Error(event.message));
      this.pause();
      this.onError(event.message);
    }
  }

  private setStatus(status: VoiceInputStatus) {
    this.status = status;
    this.onStatus(status, this.transcript);
  }

  private releaseCapture() {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context) void this.context.close().catch(() => undefined);
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.context = null;
  }

  private clearFinalTimer() {
    if (this.finalTimer !== null) window.clearTimeout(this.finalTimer);
    this.finalTimer = null;
  }

  private clearReadyTimer() {
    if (this.readyTimer !== null) window.clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  private clearTimers() {
    this.clearFinalTimer();
    this.clearReadyTimer();
    if (this.completionTimer !== null) window.clearTimeout(this.completionTimer);
    this.completionTimer = null;
  }
}
