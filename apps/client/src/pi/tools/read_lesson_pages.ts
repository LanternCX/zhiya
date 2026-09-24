import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { LessonPageTools } from "../tool";

export function readLessonPagesTool(read: LessonPageTools["read"]): AgentTool {
  return {
    name: "read_lesson_pages",
    label: "查看课堂缓冲池",
    description:
      "Read two disjoint states: the unordered buffer contains only completed pages not selected for display, while displaySequence contains only pages the teacher selected for the ordered right-side display. Use this before moving, removing, or jumping to content.",
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
