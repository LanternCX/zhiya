import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { TeachingToolContext } from "../tool";

export const activityLabel = "读取历史学习";

export function readCourseConversationTool(
  context: Pick<TeachingToolContext, "course" | "management">,
): AgentTool {
  return {
    name: "read_course_conversation",
    label: activityLabel,
    description:
      "Read one relevant previous course conversation. The result contains a bounded recent transcript and page titles so you can continue the learner's progress without reopening or modifying that old session.",
    parameters: Type.Object({
      conversationId: Type.String({ minLength: 1 }),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      if (!context.course.id) throw new Error("课程尚未建立");
      const { conversationId } = params as { conversationId: string };
      const conversation =
        await context.management.readConversation(conversationId);
      const messages = conversation.state.messages
        .slice(-40)
        .map(({ role, text }) => ({ role, text: text.slice(0, 2_000) }));
      const pages = conversation.state.pages
        .slice(-20)
        .map(({ id, title }) => ({ id, title }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: conversation.id,
              sectionId: conversation.sectionId,
              title: conversation.title,
              updatedAt: conversation.updatedAt,
              messages,
              pages,
              transcriptTruncated:
                messages.length < conversation.state.messages.length,
            }),
          },
        ],
        details: { conversationId: conversation.id },
      };
    },
  };
}
