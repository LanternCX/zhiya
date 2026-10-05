import type { InputMode } from "../../domain/learning";

export type PresentedResponse = {
  display_text: string;
  speech_text: string;
};

export class ResponsePresenter {
  static present(text: string, inputMode: InputMode): PresentedResponse {
    if (inputMode === "text") return { display_text: text, speech_text: text };
    const speechText = this.toSpeechText(text);
    return { display_text: text, speech_text: speechText };
  }

  private static toSpeechText(text: string) {
    if (/```[\s\S]*```/.test(text)) return "代码我已经放在屏幕上了。";
    if (/https?:\/\/\S+/i.test(text)) return "链接我已经放在屏幕上了。";
    return text
      .replace(/`[^`]*`/g, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/\|/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}
