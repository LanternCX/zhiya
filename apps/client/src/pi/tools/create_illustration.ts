import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { IllustrationTools } from "../tool";

export const activityLabel = "绘制教学插图";

export function createIllustrationTool(
  start: IllustrationTools["start"],
): AgentTool {
  return {
    name: "create_illustration",
    label: activityLabel,
    description:
      "Start one 16:9 teaching-illustration task and return after submission. Use it for a visual scene, concept, object, or process that benefits from a friendly 2D educational comic. Describe visual content without asking for visible text, labels, letters, numbers, formulas, logos, or watermarks. Use a unique pageId. The completed page stays hidden until show_lesson_page succeeds.",
    parameters: Type.Object({
      pageId: Type.String({ minLength: 1, maxLength: 64 }),
      title: Type.String({ minLength: 1, maxLength: 100 }),
      description: Type.String({ minLength: 1, maxLength: 1000 }),
      alt: Type.String({ minLength: 1, maxLength: 300 }),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const task = await start(
        params as {
          pageId: string;
          title: string;
          description: string;
          alt: string;
        },
      );
      return {
        content: [
          {
            type: "text",
            text: `Illustration task started: ${JSON.stringify(task)}. Continue teaching without waiting for it.`,
          },
        ],
        details: task,
      };
    },
  };
}
