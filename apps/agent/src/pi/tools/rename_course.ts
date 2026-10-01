import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { TeachingToolContext } from "../tool";

export const activityLabel = "更新课程";

export function renameCourseTool(
  context: Pick<TeachingToolContext, "course" | "management">,
): AgentTool {
  return {
    name: "rename_course",
    label: "更新课程",
    description:
      "Rename the active course when the learning direction has materially changed or the student explicitly asks. Do not call for cosmetic wording changes during ordinary teaching.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 80 }),
      topic: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const input = params as { title: string; topic?: string };
      if (!context.course.id) throw new Error("Create the course first.");
      const updated = await context.management.rename(
        String(input.title),
        input.topic === undefined ? undefined : String(input.topic),
      );
      context.course.title = updated.title;
      context.course.topic = updated.topic;
      return {
        content: [
          {
            type: "text",
            text: `Course metadata updated: ${JSON.stringify({ title: updated.title, topic: updated.topic })}.`,
          },
        ],
        details: { courseId: context.course.id },
      };
    },
  };
}
