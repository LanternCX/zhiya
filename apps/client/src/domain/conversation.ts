import type { Question } from "./learning";

// Describe the transcript fields consumed by the profile UI.
type ConversationMessage =
  | { role: "user" }
  | {
      role: "assistant";
      content: Array<
        | { type: "text"; text: string }
        | { type: "thinking"; thinking: string }
        | { type: "toolCall" }
      >;
    }
  | { role: "toolResult"; toolName: string; isError: boolean };

export type Conversation = {
  id: string;
  purpose: "onboarding";
  messages: ConversationMessage[];
  question: Question | null;
  completed: boolean;
  correctionEnded: boolean;
  memory: string;
  memoryVersion: number;
  messageSequence: number;
  revision: number;
  status: "idle" | "running" | "waiting";
  leaseUntil: string;
};
