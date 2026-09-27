import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { AnimationTools } from "../tool";

export function controlAnimationTool(
  control: AnimationTools["control"],
): AgentTool {
  return {
    name: "control_animation",
    label: "控制动画",
    description:
      "Play one named animation preset, pause the current animation, or reset it. The visible page and its playback state are shared with the student.",
    parameters: Type.Object(
      {
        pageId: Type.String({ minLength: 1, maxLength: 64 }),
        action: Type.Union([
          Type.Literal("play"),
          Type.Literal("pause"),
          Type.Literal("reset"),
        ]),
        buttonId: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 64,
            description: "Required when action is play; omit otherwise.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { pageId, action, buttonId } = params as {
        pageId: string;
        action: "play" | "pause" | "reset";
        buttonId?: string;
      };
      if (action === "play" && !buttonId) {
        throw new Error("buttonId is required when action is play");
      }
      const state = control(
        pageId,
        action === "play"
          ? { action, buttonId: buttonId! }
          : { action },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(state) }],
        details: state,
      };
    },
  };
}
