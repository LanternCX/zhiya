import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
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

/** Persisted transcript operations supplied by the server host. */
export interface ConversationStore {
  open(): Promise<Conversation>;
  current(): Promise<Conversation>;
  waitForChange(revision: number): Promise<Conversation>;
  claim(correction?: {
    correctionText: string;
    revision: number;
  }): Promise<{ runId: string }>;
  release(runId: string): Promise<unknown>;
  heartbeat(runId: string): Promise<unknown>;
  saveMessage(runId: string, message: AgentMessage): Promise<unknown>;
  executeTool(
    runId: string,
    toolCallId: string,
  ): Promise<{ waiting?: boolean; result?: ToolResultMessage }>;
  recordToolError(runId: string, toolCallId: string): Promise<unknown>;
}
