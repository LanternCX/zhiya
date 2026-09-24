import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { LessonPageTools } from "../tool";

export function showLessonPageTool(show: LessonPageTools["show"]): AgentTool {
  return {
    name: "show_lesson_page",
    label: "展示课堂页面",
    description:
      "Jump directly to a page by its stable ID. The page must already have been moved out of the buffer and into the right-side display sequence. This never waits for generation, selects buffered content, or changes display order.",
    parameters: Type.Object({ pageId: Type.String({ minLength: 1, maxLength: 64 }) }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const page = await show((params as { pageId: string }).pageId);
      return {
        content: [{ type: "text", text: `The page is now visible: ${JSON.stringify(page)}` }],
        details: { pageId: page.id },
      };
    },
  };
}
