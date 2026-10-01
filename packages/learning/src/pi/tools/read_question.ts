import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { QuestionTools } from "../tool";

export const activityLabel = "读取练习作答";

export function readQuestionTool(read: QuestionTools["read"]): AgentTool {
  return {
    name: "read_question",
    label: activityLabel,
    description: "Read a question page and its saved student response by page ID. Use this when reviewing a submission or when the student asks about an earlier question.",
    parameters: Type.Object({ pageId: Type.String({ minLength: 1, maxLength: 64 }) }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const page = read((params as { pageId: string }).pageId);
      return { content: [{ type: "text", text: JSON.stringify(page) }], details: { pageId: page.id } };
    },
  };
}
