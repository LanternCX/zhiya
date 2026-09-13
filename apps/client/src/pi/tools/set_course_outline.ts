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
      "Create or replace the ordered course outline. Each section is a meaningful teaching unit with a concise title and learning objective. Call this immediately after creating a course, before teaching. Update it later when the student's goals or explicit material constraints change.",
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
          status?: "planned" | "active" | "complete";
        }>;
      };
      const course = await context.management.setOutline(input.sections);
      return {
        content: [
          {
            type: "text",
            text: `The course outline is ready: ${JSON.stringify(
              course.sections?.map(({ id, title, objective, status }) => ({
                id,
                title,
                objective,
                status,
              })) ?? [],
            )}`,
          },
        ],
        details: { courseId: course.id },
      };
    },
  };
}
