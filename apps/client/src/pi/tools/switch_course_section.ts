import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { TeachingToolContext } from "../tool";

export const activityLabel = "切换学习小节";

export function switchCourseSectionTool(
  context: Pick<TeachingToolContext, "management">,
): AgentTool {
  return {
    name: "switch_course_section",
    label: activityLabel,
    description:
      "End the current course conversation and start a separate conversation in an existing outline section. Provide a short handoff for the new teaching agent. Call this alone from an already bound conversation after any outline update completes; this ends your current turn. Do not archive the previous section merely because you switch.",
    parameters: Type.Object({
      sectionId: Type.String({ minLength: 1 }),
      title: Type.String({ minLength: 1, maxLength: 100 }),
      handoff: Type.String({ minLength: 1, maxLength: 2000 }),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const input = params as {
        sectionId: string;
        title: string;
        handoff: string;
      };
      const conversation = await context.management.switchSection(
        input.sectionId,
        input.title,
        input.handoff,
      );
      return {
        content: [{ type: "text", text: `Switching to conversation ${conversation.id}.` }],
        details: { conversationId: conversation.id },
      };
    },
  };
}
