import type { ConversationView } from "../domain/learning";
import type { Conversation } from "./contracts";
import { correctionProgress } from "./progress";

/** Keep PI transcript details out of rendering and application state. */
export function conversationView(state: Conversation): ConversationView {
  const last = state.messages.at(-1);
  const content = last?.role === "assistant" ? last.content : [];
  return {
    id: state.id,
    question: state.question,
    completed: state.completed,
    correctionEnded: state.correctionEnded,
    memory: state.memory,
    revision: state.revision,
    status: state.status,
    leaseUntil: state.leaseUntil,
    messageCount: state.messages.length,
    lastAssistant: last?.role === "assistant",
    output: {
      text: content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
      reasoning: content
        .filter((part) => part.type === "thinking")
        .map((part) => part.thinking)
        .join("\n\n"),
      isReasoning: false,
    },
    correction: correctionProgress(state),
  };
}
