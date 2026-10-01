import { agentBranch, branchMessages, BACKGROUND_CONTEXT, type Session } from "../session";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type {
  AssistantOutput,
  ModelInfo,
  ModelRetryListener,
} from "../../../../../packages/learning/src/domain/learning";
import type { Conversation, ConversationStore } from "../contracts";
import type { ModelGateway } from "../gateway";
import { createOnboardingAgent } from "../agent/onboarding";

const maxInterruptedTurnRetries = 5;

function interruptedAssistant(message: AgentMessage | undefined) {
  return (
    message?.role === "assistant" &&
    message.stopReason === "error" &&
    message.errorMessage?.includes("模型连接中断，请重试")
  );
}

import { correctionProgress } from "../../../../../packages/learning/src/conversation/progress";

export class ProfileSession {
  private agent: Agent | null = null;
  private stopped = false;
  private runId = "";
  private cancelRetryWait: (() => void) | null = null;
  constructor(
    private gateway: ModelGateway,
    private info: ModelInfo,
    private store: ConversationStore,
    private update: (state: Conversation) => void,
    private output: (value: AssistantOutput) => void,
    private onRetry: ModelRetryListener,
    private transcript?: Session,
  ) {}
  get isStopped() {
    return this.stopped;
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelRetryWait?.();
    this.agent?.abort();
    if (this.runId) void this.store.release(this.runId).catch(() => {});
  }
  private waitBeforeRetry(attempt: number) {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.cancelRetryWait === finish) this.cancelRetryWait = null;
        resolve();
      };
      const timer = setTimeout(
        finish,
        Math.min(500 * 2 ** (attempt - 1), 8000),
      );
      this.cancelRetryWait = finish;
    });
  }
  private async recoverInterruptedTurn(agent: Agent) {
    for (let attempt = 1; attempt <= maxInterruptedTurnRetries; attempt++) {
      const failed = agent.state.messages.at(-1);
      if (!interruptedAssistant(failed)) return;
      agent.state.messages = agent.state.messages.slice(0, -1);
      this.output({ text: "", reasoning: "", isReasoning: false });
      this.onRetry({ attempt, maxRetries: maxInterruptedTurnRetries });
      await this.waitBeforeRetry(attempt);
      if (this.stopped) return;
      await agent.continue();
    }
  }
  private async refresh() {
    const state = await this.store.current();
    if (!this.stopped) this.update(state);
    return state;
  }
  private async execute(id: string): Promise<ToolResultMessage> {
    if (this.stopped) throw new Error("会话已离开");
    const response = await this.store.executeTool(this.runId, id);
    let state = await this.refresh();
    if (response.result) return response.result;
    while (!this.stopped) {
      const result = state.messages.find(
        (m): m is ToolResultMessage =>
          m.role === "toolResult" && m.toolCallId === id,
      );
      if (result) return result;
      state = await this.store.waitForChange(state.revision);
      if (!this.stopped) this.update(state);
    }
    throw new Error("会话已离开");
  }
  async run(userText?: string) {
    const initial = await this.store.open();
    if (this.stopped) return;
    const startingCorrection = initial.completed && Boolean(userText);
    const claim = await this.store.claim(
      startingCorrection && userText
        ? { correctionText: userText, revision: initial.revision }
        : undefined,
    );
    this.runId = claim.runId;
    const heartbeat = setInterval(() => {
      if (!this.stopped)
        void this.store.heartbeat(this.runId).catch(() => this.stop());
    }, 10000);
    try {
      if (this.stopped) return;
      let state = await this.refresh();
      const correcting =
        state.completed &&
        (Boolean(userText) || correctionProgress(state) !== null);
      // Complete persisted calls in their original order before continuing the loop.
      for (const message of state.messages) {
        if (message.role !== "assistant") continue;
        for (const block of message.content) {
          if (
            block.type === "toolCall" &&
            !state.messages.some(
              (m) => m.role === "toolResult" && m.toolCallId === block.id,
            )
          ) {
            await this.execute(block.id);
            state = await this.refresh();
          }
        }
      }
      const branch = this.transcript
        ? await agentBranch(this.transcript, "onboarding")
        : undefined;
      const messages = branch
        ? await branchMessages(branch)
        : [...state.messages];
      if (branch) {
        // Submitted answers and correction requests enter through Go's product workflow.
        // Import acknowledged external messages before Pi continues the agent loop.
        for (const message of state.messages) {
          const present = messages.some(
            (saved) =>
              saved.role === message.role &&
              (message.role === "toolResult"
                ? saved.role === "toolResult" &&
                  saved.toolCallId === message.toolCallId
                : saved.timestamp === message.timestamp),
          );
          if (!present) {
            await branch.appendMessage(message, BACKGROUND_CONTEXT);
            messages.push(message);
          }
        }
      }
      if (correcting && !userText) {
        // Retry an interrupted structured turn without inventing a student reply.
        while (messages.at(-1)?.role === "assistant") {
          const last = messages[messages.length - 1];
          if (last.role !== "assistant") break;
          if (last.content.some((block) => block.type === "toolCall")) break;
          messages.pop();
        }
      }
      const agent = createOnboardingAgent({
        model: this.info,
        gateway: this.gateway,
        runId: this.runId,
        messages,
        branch,
        correcting,
        context: () => {
          const progress = correctionProgress(state);
          return {
            memory: state.memory,
            memoryVersion: state.memoryVersion,
            answered: Boolean(progress?.answered),
            saved: Boolean(progress?.saved),
          };
        },
        execute: (id) => this.execute(id),
        onRetry: this.onRetry,
      });
      this.agent = agent;
      agent.subscribe(async (event) => {
        if (this.stopped) return;
        if (
          (event.type === "message_start" ||
            event.type === "message_update" ||
            event.type === "message_end") &&
          event.message.role === "assistant"
        ) {
          const message = event.message as AssistantMessage;
          this.output({
            text: message.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join(""),
            reasoning: message.content
              .filter((b) => b.type === "thinking")
              .map((b) => b.thinking)
              .join("\n\n"),
            isReasoning:
              event.type === "message_update" &&
              ["thinking_start", "thinking_delta"].includes(
                event.assistantMessageEvent.type,
              ),
          });
        }
        if (
          event.type === "message_end" &&
          (event.message.role === "assistant" || event.message.role === "user")
        ) {
          if (
            event.message.role === "assistant" &&
            (event.message.stopReason === "error" ||
              event.message.stopReason === "aborted")
          )
            return;
          await this.store.saveMessage(this.runId, event.message);
          state = await this.refresh();
        }
        if (event.type === "tool_execution_end") {
          state = await this.refresh();
          if (
            event.isError &&
            !state.messages.some(
              (m) =>
                m.role === "toolResult" && m.toolCallId === event.toolCallId,
            )
          ) {
            if (this.stopped) return;
            await this.store.recordToolError(this.runId, event.toolCallId);
            state = await this.refresh();
          }
        }
      });
      if (this.stopped) return;
      if (userText && !startingCorrection) await agent.prompt(userText);
      else if (state.messages.length === 0)
        await agent.prompt("请开始认识我，帮助我找到适合自己的学习方式。");
      else if (agent.state.messages.at(-1)?.role !== "assistant")
        await agent.continue();
      await this.recoverInterruptedTurn(agent);
      this.onRetry(null);
      if (agent.state.errorMessage)
        throw new Error("交流暂时中断了，你的回答已保存，请重试。");
      if (correcting && !correctionProgress(state)?.saved)
        throw new Error("档案修改尚未完成，请继续交流。你的已提交回答已保留。");
    } finally {
      this.onRetry(null);
      clearInterval(heartbeat);
      // Release only this execution; a replacement run's token cannot be affected.
      await this.store.release(this.runId).catch(() => {});
      if (!this.stopped) await this.refresh();
    }
  }
}
