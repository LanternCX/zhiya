import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

export const activityLabel = "调整后续内容";

export function cancelSlidesTool(cancel: () => void): AgentTool {
  return {
    name: "cancel_slides",
    label: "停止生成课件",
    description:
      "Cancel the current unfinished slide generation when it conflicts with the student's new direction.",
    parameters: Type.Object({}),
    execute: async () => {
      cancel();
      return {
        content: [
          {
            type: "text",
            text: "Unfinished slide generation was cancelled.",
          },
        ],
        details: {},
      };
    },
  };
}
