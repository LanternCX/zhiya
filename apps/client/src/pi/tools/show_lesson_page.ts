import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { AnimationTools } from "../tool";

export function showLessonPageTool(show: AnimationTools["show"]): AgentTool {
  return {
    name: "show_lesson_page",
    label: "展示课堂页面",
    description:
      "Show a lesson page by its stable page ID. If that page is still generating, wait for it. The call fails only when the page task reaches a terminal failure.",
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
