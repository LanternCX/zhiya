import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { LessonPageTools } from "../tool";

export function placeLessonPageTool(
  place: LessonPageTools["place"],
): AgentTool {
  return {
    name: "place_lesson_page",
    label: "编排课堂页面",
    description:
      "Move one completed page from the unordered buffer into an exact 1-based position in the right-side display sequence, or reposition a page already selected for display. Buffered pages remain invisible and unreachable through next/previous navigation. This changes the sequence without changing the current visible page.",
    parameters: Type.Object({
      pageId: Type.String({ minLength: 1, maxLength: 64 }),
      position: Type.Integer({ minimum: 1 }),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { pageId, position } = params as {
        pageId: string;
        position: number;
      };
      const state = place(pageId, position);
      return {
        content: [
          {
            type: "text",
            text: `Lesson page moved into the display sequence: ${JSON.stringify({ pageId, position, ...state })}`,
          },
        ],
        details: { pageId, position, ...state },
      };
    },
  };
}
