import { createMockProvider } from "./mock.mjs";
import { createQwenProvider } from "./qwen.mjs";
import { createVolcProvider } from "./volcengine.mjs";

export function createProvider(config) {
  if (config.provider === "mock") return createMockProvider({ transcript: config.text });
  if (config.provider === "qwen") return createQwenProvider({ apiKey: config.apiKey });
  if (config.provider === "volcengine") return createVolcProvider({ endpoint: config.endpoint, apiKey: config.apiKey });
  throw new Error(`Provider ${config.provider} is not implemented in this demo yet`);
}
