import type { InputMode } from "../domain/learning";

export type PresentedResponse = {
  display_text: string;
  speech_text: string;
};

export class ResponsePresenter {
  static modePrompt(inputMode: InputMode) {
    if (inputMode === "text") return "";
    return "当前用户正在通过语音与你交流。请使用自然、简洁、口语化的方式回答。普通问题优先控制在 1～3 句话。不要像文章一样回答，避免大量标题、Markdown 和长列表。代码、表格、URL 或其他不适合朗读的内容，只进行简要说明，不要逐字朗读代码、表格或 URL。";
  }

  static present(text: string, inputMode: InputMode): PresentedResponse {
    if (inputMode === "text") return { display_text: text, speech_text: text };
    const speechText = this.toSpeechText(text);
    return { display_text: speechText, speech_text: speechText };
  }

  private static toSpeechText(text: string) {
    if (/```[\s\S]*```/.test(text)) return "代码我已经放在屏幕上了。";
    if (/https?:\/\/\S+/i.test(text)) return "链接我已经放在屏幕上了。";
    return text
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/\|/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}
