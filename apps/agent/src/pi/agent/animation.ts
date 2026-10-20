import type { Branch } from "@earendil-works/pi-agent-core/harness/session";
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
  branch?: () => Promise<Branch>;
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
    branch: options.branch,
    tools: [
      publishAnimationTool((page) => {
        options.publish(page);
        published = true;
      }),
    ],
    systemPrompt: `You create one structured K12 diagram or teaching animation without visual feedback. Describe content and relationships; the app computes node sizes, positions and connection routes. Static flowcharts and mind maps use buttons: []. Add buttons only for requested changing processes. Cycles, return edges and self-loops are allowed; never remove a meaningful relationship merely to make a graph acyclic. Groups are non-nested visual containers. Prefer horizontal or vertical reading direction. Prefer the fewest elements that can explain the idea. Publish exactly one complete scene with publish_animation. The pageId must be ${JSON.stringify(options.pageId)}. Hard limits: at most ${animationLimits.nodes} nodes, ${animationLimits.edges} edges, ${animationLimits.buttons} buttons, ${animationLimits.stepsPerButton} steps per button, ${animationLimits.actionsPerStep} actions per step, and ${animationLimits.actionsPerPage} actions on the whole page. Use only the provided shapes, relationships, layouts, buttons, and actions. Never output SVG, HTML, CSS, JavaScript, colors, or coordinates. Keep labels concise. Every ID must be unique, every edge must reference existing nodes, and every action must reference an existing node or edge; flow actions target edges only. If publish_animation returns an error, correct the named structure and call it again. After it succeeds, stop. Do not emit prose outside tool calls.\nStudent memory:\n${options.memory || "No saved preferences yet."}`,
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
