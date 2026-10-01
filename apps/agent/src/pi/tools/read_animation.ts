import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { AnimationTools } from "../tool";

export function readAnimationTool(
  playback: AnimationTools["playback"],
): AgentTool {
  return {
    name: "read_animation",
    label: "查看动画状态",
    description:
      "Read the actual playback state of one interactive animation page before narrating its progress.",
    parameters: Type.Object({
      pageId: Type.String({ minLength: 1, maxLength: 64 }),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const state = playback((params as { pageId: string }).pageId);
      return {
        content: [{ type: "text", text: JSON.stringify(state) }],
        details: state,
      };
    },
  };
}
