import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { LessonPageTools } from "../tool";

export function removeLessonPageTool(
  remove: LessonPageTools["remove"],
): AgentTool {
  return {
    name: "remove_lesson_page",
    label: "移出课堂序列",
    description:
      "Move one page out of the right-side display sequence and back into the unordered buffer. It is no longer reachable through next/previous navigation and can be selected again later.",
    parameters: Type.Object({
      pageId: Type.String({ minLength: 1, maxLength: 64 }),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { pageId } = params as { pageId: string };
      const state = remove(pageId);
      return {
        content: [
          {
            type: "text",
            text: `Lesson page returned to the buffer: ${JSON.stringify({ pageId, ...state })}`,
          },
        ],
        details: { pageId, ...state },
      };
    },
  };
}
