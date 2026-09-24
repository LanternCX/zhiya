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
      "Start exactly one independent 16:9 teaching-illustration task and return after submission. Call this tool exactly once per requested image; multiple calls in the same turn run in parallel. Do not add slides or animations merely to balance an image request. Use it for a visual scene, concept, object, or process that benefits from a friendly 2D educational comic. Describe a natural scene rather than a presentation slide, infographic, UI, knowledge card, or framed collage. Never ask for visible text, labels, letters, numbers, formulas, logos, or watermarks. Use a unique pageId. Each completed page enters only the unordered buffer and stays hidden until the teacher explicitly moves it into the display sequence and show_lesson_page succeeds; it can be cancelled or replaced independently.",
    parameters: Type.Object({
      pageId: Type.String({ minLength: 1, maxLength: 64 }),
      title: Type.String({ minLength: 1, maxLength: 100 }),
      description: Type.String({ minLength: 1, maxLength: 1000 }),
      alt: Type.String({ minLength: 1, maxLength: 300 }),
    }),
    executionMode: "parallel",
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
