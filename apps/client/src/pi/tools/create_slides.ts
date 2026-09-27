import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { SlideTools } from "../tool";

export type SlideRequest = {
  goal: string;
  pageCount: number;
  replaceCurrent: boolean;
  background?: boolean;
};

export const activityLabel = "准备课件";

export function createSlidesTool(start: SlideTools["start"]): AgentTool {
  return {
    name: "create_slides",
    label: "生成课件",
    description:
      "Generate presentation pages with a child agent. By default wait for the first usable page and return its content plus stable IDs for every requested page; remaining pages continue generating. Use show_lesson_page to teach each page, including a pending page: that tool waits until it is ready. Set background=true only for optional preparation you do not need to teach now. Generation never changes the visible page.",
    parameters: Type.Object({
      goal: Type.String(),
      pageCount: Type.Integer({ minimum: 1, maximum: 10 }),
      replaceCurrent: Type.Boolean(),
      background: Type.Optional(Type.Boolean()),
    }),
    executionMode: "sequential",
    execute: async (id, params, signal) => {
      const task = await start(id, params as SlideRequest, signal);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(task),
          },
        ],
        details: task,
      };
    },
  };
}
