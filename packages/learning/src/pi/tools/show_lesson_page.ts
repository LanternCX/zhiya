import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { LessonPageTools } from "../tool";

export function showLessonPageTool(show: LessonPageTools["show"]): AgentTool {
  return {
    name: "show_lesson_page",
    label: "展示课堂页面",
    description:
      "Teach a page by stable page ID. Wait if this page is still generating, then append a new presentation to the lecture history and make it visible. Reusing a page preserves its content and coding state but creates a new teaching occurrence. Explain it only after this tool succeeds. A student interruption cancels the pending presentation; reconsider their message before continuing.",
    parameters: Type.Object({
      pageId: Type.String({ minLength: 1, maxLength: 64 }),
    }),
    executionMode: "sequential",
    execute: async (id, params, signal) => {
      const page = await show(
        id,
        (params as { pageId: string }).pageId,
        signal,
      );
      return {
        content: [{ type: "text", text: `The page is now visible: ${JSON.stringify(page)}` }],
        details: { pageId: page.id },
      };
    },
  };
}
