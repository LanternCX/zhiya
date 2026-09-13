import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { TeachingToolContext } from "../tool";

export const activityLabel = "建立新学习对话";

export function createCourseConversationTool(
  context: Pick<TeachingToolContext, "course" | "management">,
): AgentTool {
  return {
    name: "create_course_conversation",
    label: activityLabel,
    description:
      "Create a separate conversation under one existing outline section for an explicit relearning, review, or independent-practice activity. Do not use this for ordinary follow-up questions. Call it before teaching the new activity.",
    parameters: Type.Object({
      sectionId: Type.String({ minLength: 1 }),
      title: Type.String({ minLength: 1, maxLength: 100 }),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      if (!context.course.id) throw new Error("课程尚未建立");
      const input = params as { sectionId: string; title: string };
      const conversation = await context.management.createConversation(
        input.sectionId,
        input.title,
      );
      return {
        content: [
          {
            type: "text",
            text: `The new course conversation is ready: ${JSON.stringify({ id: conversation.id, sectionId: conversation.sectionId, title: conversation.title })}. Continue the requested activity now.`,
          },
        ],
        details: { conversationId: conversation.id },
      };
    },
  };
}
