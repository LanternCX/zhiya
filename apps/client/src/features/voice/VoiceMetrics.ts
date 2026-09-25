export type VoiceMetricName = "connection" | "asr_final" | "agent_first_token" | "first_tts_audio" | "interruption";

export class VoiceMetrics {
  private readonly startedAt: number;
  private readonly marks = new Map<VoiceMetricName, number>();
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
    this.startedAt = now();
  }

  mark(name: VoiceMetricName) {
    if (!this.marks.has(name)) this.marks.set(name, Math.max(0, this.now() - this.startedAt));
  }

  snapshot() {
    return Object.fromEntries(this.marks) as Partial<Record<VoiceMetricName, number>>;
  }
}
