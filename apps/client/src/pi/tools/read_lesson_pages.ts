import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { LessonPageTools } from "../tool";

export function readLessonPagesTool(read: LessonPageTools["read"]): AgentTool {
  return {
    name: "read_lesson_pages",
    label: "查看课堂进度与素材",
    description:
      "Read ready page assets, tasks with stable pending page IDs, the ordered presentation history, and the student's current presentation. Pages can appear in multiple presentations; presenting a page never copies its interactive state. Use show_lesson_page to teach a ready or pending page.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async () => {
      const state = read();
      return {
        content: [{ type: "text", text: JSON.stringify(state) }],
        details: state,
      };
    },
  };
}
