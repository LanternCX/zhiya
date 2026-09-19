import type {
  ModelInfo,
  ModelRetryListener,
  AnimationPage,
} from "../../domain/learning";
import type { ModelGateway } from "../gateway";
import { createAgent } from "../agent";
import {
  animationLimits,
  publishAnimationTool,
} from "../tools/publish_animation";

export function createAnimationAgent(options: {
  model: ModelInfo;
  gateway: ModelGateway;
  memory: string;
  pageId: string;
  publish: (
    page: Omit<AnimationPage, "kind" | "id"> & { pageId: string },
  ) => void;
  onRetry: ModelRetryListener;
}) {
  let published = false;
  return createAgent({
    model: options.model,
    tools: [
      publishAnimationTool((page) => {
        options.publish(page);
        published = true;
      }),
    ],
    systemPrompt: `You create one simple, constrained K12 teaching animation for a model with no visual feedback. Prefer the fewest elements that can explain the idea. Publish exactly one complete scene with publish_animation. The pageId must be ${JSON.stringify(options.pageId)}. Hard limits: at most ${animationLimits.nodes} nodes, ${animationLimits.edges} edges, ${animationLimits.buttons} buttons, ${animationLimits.stepsPerButton} steps per button, ${animationLimits.actionsPerStep} actions per step, and ${animationLimits.actionsPerPage} actions on the whole page. Use only the provided shapes, relationships, layouts, buttons, and actions. Never output SVG, HTML, CSS, JavaScript, colors, or coordinates. Keep labels concise. Before publishing, verify that every ID is unique, every edge references existing nodes, and every action references an existing node or edge. If the requested idea is complex, simplify it to one key relationship or split the explanation conceptually instead of adding elements. If publish_animation returns an error, reduce or correct the scene and call it again. After it succeeds, stop. Do not emit prose outside tool calls.\nStudent memory:\n${options.memory || "No saved preferences yet."}`,
    shouldStopAfterTurn: () => published,
    request: (payload, signal) => {
      return options.gateway.course(
        "animation",
        payload,
        signal,
        options.onRetry,
      );
    },
  });
}
