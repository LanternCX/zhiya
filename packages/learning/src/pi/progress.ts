import type { Conversation } from "./contracts";

// Derive correction progress from acknowledged tools, not generated prose.
// Keeping this in the transcript also lets another device resume the same flow.
export function correctionProgress(state: Conversation) {
  if (!state.completed || state.correctionEnded) return null;
  let completedAt = -1;
  let startedAt = -1;
  state.messages.forEach((message, index) => {
    if (message.role === "user") startedAt = index;
    if (
      message.role === "toolResult" &&
      message.toolName === "complete_onboarding" &&
      !message.isError
    )
      completedAt = index;
  });
  if (startedAt <= completedAt) return null;
  let answered = false;
  let saved = false;
  for (const message of state.messages.slice(startedAt + 1)) {
    if (message.role !== "toolResult" || message.isError) continue;
    if (message.toolName === "ask_student") answered = true;
    if (message.toolName === "update_memory" && answered) saved = true;
  }
  return { answered, saved };
}
