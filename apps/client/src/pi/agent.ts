import {
  Agent,
  type AgentMessage,
  type AgentTool,
  type AgentOptions,
} from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import type { ModelInfo } from "../domain/learning";

type AgentSetup = {
  model: ModelInfo;
  messages?: AgentMessage[];
  tools: AgentTool[];
  systemPrompt: string | (() => string);
  request: (
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Response>;
  shouldStopAfterTurn?: AgentOptions["shouldStopAfterTurn"];
};

/** Shared model and streaming policy; each scenario supplies its prompt, tools and request. */
export function createAgent(setup: AgentSetup) {
  const prompt = () =>
    typeof setup.systemPrompt === "function"
      ? setup.systemPrompt()
      : setup.systemPrompt;
  const model: Model<"openai-completions"> = {
    id: setup.model.id,
    name: setup.model.id,
    api: "openai-completions",
    provider: "zhiya",
    baseUrl: "https://zhiya.invalid/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 8192,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
    },
  };
  return new Agent({
    initialState: {
      model,
      messages: setup.messages ?? [],
      tools: setup.tools,
      systemPrompt: prompt(),
    },
    toolExecution: "sequential",
    shouldStopAfterTurn: setup.shouldStopAfterTurn,
    streamFn: (_model, context, options) =>
      streamSimple(
        model,
        { ...context, systemPrompt: prompt() },
        {
          ...options,
          apiKey: "server-managed",
          maxRetries: 0,
          fetch: (_url, init) =>
            setup.request(JSON.parse(String(init?.body)), init?.signal ?? undefined),
        },
      ),
  });
}
