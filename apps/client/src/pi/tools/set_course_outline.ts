import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { TeachingToolContext } from "../tool";

export const activityLabel = "规划课程大纲";

export function setCourseOutlineTool(
  context: Pick<TeachingToolContext, "course" | "management">,
): AgentTool {
  return {
    name: "set_course_outline",
    label: activityLabel,
    description:
      "Create or replace the ordered course outline. Each section is a meaningful teaching unit with a concise title and learning objective. Call this immediately after creating a course, before teaching. Update it later when the student's goals or explicit material constraints change. Multiple sections may be active at the same time. Use archived only when intentionally retaining a section and its history outside the current learning flow. Omitted old sections are deleted after their conversations are reclassified; omission is not archival.",
    parameters: Type.Object({
      sections: Type.Array(
        Type.Object({
          id: Type.Optional(Type.String()),
          title: Type.String({ minLength: 1, maxLength: 100 }),
          objective: Type.String({ minLength: 1, maxLength: 500 }),
          status: Type.Optional(
            Type.Union([
              Type.Literal("planned"),
              Type.Literal("active"),
              Type.Literal("complete"),
              Type.Literal("archived"),
            ]),
          ),
        }),
        { minItems: 1, maxItems: 100 },
      ),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      if (!context.course.id) throw new Error("课程尚未建立");
      const input = params as {
        sections: Array<{
          id?: string;
          title: string;
          objective: string;
          status?: "planned" | "active" | "complete" | "archived";
        }>;
      };
      const result = await context.management.setOutline(input.sections);
      if ("taskId" in result) {
        return {
          content: [
            {
              type: "text",
              text: `Course outline task started: ${JSON.stringify(result)}. Do not create a section conversation until the completion notice arrives. Continue helping the student without waiting.`,
            },
          ],
          details: result,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `The course outline is ready: ${JSON.stringify(
              result.sections?.map(({ id, title, objective, status }) => ({
                id,
                title,
                objective,
                status,
              })) ?? [],
            )}`,
          },
        ],
        details: { courseId: result.id },
      };
    },
  };
}
