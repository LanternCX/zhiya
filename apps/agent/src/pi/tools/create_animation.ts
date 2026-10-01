import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { AnimationTools } from "../tool";
import { animationLimits } from "./publish_animation";

export const activityLabel = "准备动画";

export function createAnimationTool(start: AnimationTools["start"]): AgentTool {
  return {
    name: "create_animation",
    label: activityLabel,
    description: `Start one simple animation-page task in the background and return immediately. Keep the goal within the supported basic shapes, relationships, and button-driven steps: at most ${animationLimits.nodes} nodes, ${animationLimits.edges} edges, ${animationLimits.buttons} buttons, ${animationLimits.stepsPerButton} steps per button, ${animationLimits.actionsPerStep} actions per step, and ${animationLimits.actionsPerPage} actions total. Request no colors, custom icons, coordinates, code, SVG, complex morphing, or extra reset controls. Use a unique pageId, then use show_lesson_page when you are ready to present it.`,
    parameters: Type.Object({
      pageId: Type.String({ minLength: 1, maxLength: 64 }),
      goal: Type.String({ minLength: 1, maxLength: 500 }),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const task = start(params as { pageId: string; goal: string });
      return {
        content: [
          {
            type: "text",
            text: `Animation task started: ${JSON.stringify(task)}. You can do independent teaching now, or call show_lesson_page to wait for and teach this page. Completion alone never presents it.`,
          },
        ],
        details: task,
      };
    },
  };
}
