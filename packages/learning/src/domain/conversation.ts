import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Question } from "../domain/learning";

export type Conversation = {
  id: string;
  purpose: "onboarding";
  messages: AgentMessage[];
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
