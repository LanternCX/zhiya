export type TextChunkerOptions = {
  minChars?: number;
  maxChars?: number;
};

export class TextChunker {
  private readonly minChars: number;
  private readonly maxChars: number;
  private buffer = "";

  constructor(options: TextChunkerOptions = {}) {
    this.minChars = Math.max(1, options.minChars ?? 8);
    this.maxChars = Math.max(this.minChars, options.maxChars ?? 240);
  }

  push(text: string, flush = false) {
    this.buffer += text;
    const chunks: string[] = [];
    while (this.buffer) {
      const boundary = this.buffer.search(/[。！？!?；;\n]/);
      if (boundary >= 0) {
        let end = boundary + 1;
        let candidate = this.buffer.slice(0, end).trim();
        while (candidate.length < this.minChars && !flush) {
          const next = this.buffer.slice(end).search(/[。！？!?；;\n]/);
          if (next < 0) break;
          end += next + 1;
          candidate = this.buffer.slice(0, end).trim();
        }
        if (candidate.length < this.minChars && !flush) break;
        chunks.push(candidate);
        this.buffer = this.buffer.slice(end).trimStart();
        continue;
      }
      if (!flush && this.buffer.length < this.maxChars) break;
      const end = flush ? this.buffer.length : this.maxChars;
      const candidate = this.buffer.slice(0, end).trim();
      if (candidate.length < this.minChars && !flush) break;
      chunks.push(candidate);
      this.buffer = this.buffer.slice(end).trimStart();
    }
    return chunks.filter(Boolean);
  }

  reset() {
    this.buffer = "";
  }
}
