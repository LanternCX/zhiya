import { float32ToPcm16 } from "../../transport/speech";
import { detectVoiceFrame, type VadConfig, type VadResult } from "./vad";

export type MicrophoneCaptureOptions = {
  onPcm: (pcm: ArrayBuffer) => void;
  onVadEvent?: (event: VadResult) => void;
  vad?: Partial<VadConfig>;
};

const defaultVad: VadConfig = { threshold: 0.03, minSpeechFrames: 2, endSilenceFrames: 12, speechFrames: 0, silenceFrames: 0 };

export class MicrophoneCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: AudioWorkletNode | null = null;
  private muted = false;
  private vad: VadConfig = { ...defaultVad };
  private readonly options: MicrophoneCaptureOptions;

  constructor(options: MicrophoneCaptureOptions) { this.options = options; }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.context = new AudioContext();
    await this.context.audioWorklet.addModule("/audio/voice-capture-processor.js");
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = new AudioWorkletNode(this.context, "voice-capture-processor");
    this.vad = { ...defaultVad, ...this.options.vad };
    this.processor.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      const samples = data instanceof Float32Array ? data : new Float32Array(data);
      const event = detectVoiceFrame(samples, this.vad);
      this.vad = { ...this.vad, speechFrames: event.speechFrames, silenceFrames: event.silenceFrames };
      this.options.onVadEvent?.(event);
      if (!this.muted) this.options.onPcm(float32ToPcm16(samples, this.context?.sampleRate ?? 48000));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
    await this.context.resume();
  }

  mute() { this.muted = true; }
  unmute() { this.muted = false; }

  stop() {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close();
    this.processor = null; this.source = null; this.stream = null; this.context = null;
  }
}
