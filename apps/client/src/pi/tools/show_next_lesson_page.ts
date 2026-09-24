import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { LessonPageTools } from "../tool";

export const activityLabel = "切换下一页";

export function showNextLessonPageTool(
  next: LessonPageTools["next"],
): AgentTool {
  return {
    name: "show_next_lesson_page",
    label: activityLabel,
    description:
      "Jump to the next page in the already arranged right-side display sequence. This never selects or reveals anything from the unordered buffer and never waits for unfinished generation.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async () => {
      const page = await next();
      return {
        content: [
          {
            type: "text",
            text: `The next sequenced page is now visible: ${JSON.stringify(page)}. Explain only this page before advancing again.`,
          },
        ],
        details: { page },
      };
    },
  };
}
