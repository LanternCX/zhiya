import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { TeachingToolContext } from "../tool";

export const activityLabel = "查看历史学习";

export function listCourseConversationsTool(
  context: Pick<TeachingToolContext, "course" | "management">,
): AgentTool {
  return {
    name: "list_course_conversations",
    label: activityLabel,
    description:
      "List the course's previous learning conversations before deciding what a new session should teach. Each item includes its section, timestamps, size, and a short latest-message preview. Use read_course_conversation only for relevant history.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async () => {
      if (!context.course.id) throw new Error("课程尚未建立");
      const conversations = await context.management.listConversations();
      const summaries = conversations.map((conversation) => ({
        id: conversation.id,
        sectionId: conversation.sectionId,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.state.messages.length,
        pageCount: conversation.state.pages.length,
        latestMessage:
          conversation.state.messages.at(-1)?.text.slice(0, 240) ?? "",
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summaries) }],
        details: { count: summaries.length },
      };
    },
  };
}
