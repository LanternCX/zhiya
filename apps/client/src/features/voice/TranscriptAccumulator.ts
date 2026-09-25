export type TranscriptResult = {
  text: string;
  final: boolean;
  submit: boolean;
};

export class TranscriptAccumulator {
  private finalReceived = false;

  accept(text: string, final: boolean): TranscriptResult {
    if (!final) return { text, final: false, submit: false };
    const submit = !this.finalReceived;
    this.finalReceived = true;
    return { text, final: true, submit };
  }

  reset() {
    this.finalReceived = false;
  }
}
