export class PlaybackController {
  private context: AudioContext | null = null;
  private nextAudioTime = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly onIdle: () => void;

  constructor(onIdle: () => void = () => undefined) {
    this.onIdle = onIdle;
  }

  get isPlaying() {
    return this.sources.size > 0;
  }

  enqueue(encoded: string, sampleRate: number) {
    const context = this.context ??= new AudioContext();
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const buffer = context.createBuffer(1, Math.floor(bytes.byteLength / 2), sampleRate);
    const channel = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = view.getInt16(index * 2, true) / 0x8000;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.sources.add(source);
    const start = Math.max(context.currentTime, this.nextAudioTime);
    this.nextAudioTime = start + buffer.duration;
    source.onended = () => {
      this.sources.delete(source);
      if (!this.sources.size) {
        this.nextAudioTime = 0;
        this.onIdle();
      }
    };
    source.start(start);
  }

  stop() {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* source may have already ended */ }
    }
    this.sources.clear();
    this.nextAudioTime = 0;
    this.onIdle();
  }

  clear() {
    this.stop();
  }

  dispose() {
    this.stop();
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => undefined);
  }
}
