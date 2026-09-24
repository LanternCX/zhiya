import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

export type SlideRequest = {
  goal: string;
  pageCount: number;
  replaceCurrent: boolean;
};

export const activityLabel = "准备课件";

export function createSlidesTool(
  start: (request: SlideRequest) => { taskId: string; status: "running" },
): AgentTool {
  return {
    name: "create_slides",
    label: "生成课件",
    description:
      "Start generating one or more presentation pages in the background and return the task immediately. Completed pages enter only the unordered lesson-page buffer. The teacher must explicitly select pages from the buffer with place_lesson_page before they exist in the right-side display. Use this whenever text-led visual teaching pages help.",
    parameters: Type.Object({
      goal: Type.String(),
      pageCount: Type.Integer({ minimum: 1, maximum: 10 }),
      replaceCurrent: Type.Boolean(),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const task = start(params as SlideRequest);
      return {
        content: [
          {
            type: "text",
            text: `Slide task started: ${JSON.stringify(task)}. Continue teaching without waiting. Generated pages remain hidden until you present them; never refer to a page as visible before a show tool succeeds.`,
          },
        ],
        details: task,
      };
    },
  };
}
