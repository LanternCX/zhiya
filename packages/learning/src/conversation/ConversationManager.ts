import type { CourseMessage, InputMode, UserMessage } from "../domain/learning";

export class ConversationManager {
  static userMessage(
    text: string,
    inputMode: InputMode,
    materials: string[] = [],
  ): UserMessage {
    const message: UserMessage = {
      role: "user",
      text: text.trim(),
      input_mode: inputMode,
    };
    if (materials.length) message.materials = materials;
    return message;
  }

  static normalizeUserMessage(message: Pick<CourseMessage, "role" | "text" | "input_mode" | "materials">): UserMessage {
    return {
      role: "user",
      text: message.text,
      input_mode: message.input_mode ?? "text",
      ...(message.materials?.length ? { materials: message.materials } : {}),
    };
  }
}
