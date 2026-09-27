import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { SlideTools } from "../tool";

export const activityLabel = "核对课件状态";

export function readSlidesTool(read: SlideTools["read"]): AgentTool {
  return {
    name: "read_slides",
    label: "读取当前课件",
    description:
      "Read completed slide assets and whether more are generating. Use read_lesson_pages for pending page IDs and presentation history; show_lesson_page waits for a pending page without polling.",
    parameters: Type.Object({}),
    execute: async () => {
      const state = read();
      return {
        content: [{ type: "text", text: JSON.stringify(state) }],
        details: { pages: state.pages.length },
      };
    },
  };
}
