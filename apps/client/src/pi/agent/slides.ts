import type {
  ModelInfo,
  ModelRetryListener,
  Slide,
} from "../../domain/learning";
import type { ModelGateway } from "../gateway";
import { createAgent } from "../agent";
import { publishSlideTool } from "../tools/publish_slide";

function slidesPrompt(memory: string) {
  return `You create clear K12 presentation pages for a live lesson. Publish pages one at a time with publish_slide so the first page enters the lesson buffer quickly. Create exactly the requested number unless the task is cancelled. Supply concise plain text only: never put Markdown, HTML, or SVG markup in title, kicker, body, or bullets. Each page must stand on its own and stay faithful to the goal. Do not emit prose outside tool calls.\nStudent memory:\n${memory || "No saved preferences yet."}`;
}

export function createSlidesAgent(options: {
  model: ModelInfo;
  gateway: ModelGateway;
  memory: string;
  publish: (id: string, page: Omit<Slide, "id" | "kind">) => number;
  onRetry: ModelRetryListener;
}) {
  return createAgent({
    model: options.model,
    tools: [publishSlideTool(options.publish)],
    systemPrompt: slidesPrompt(options.memory),
    request: (payload, signal) => {
      return options.gateway.course("slides", payload, signal, options.onRetry);
    },
  });
}
