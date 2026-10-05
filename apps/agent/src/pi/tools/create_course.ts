import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { TeachingToolContext } from "../tool";
import type { CourseCover } from "../../domain/learning";

export const activityLabel = "建立课程";

export function createCourseTool(
  context: Pick<TeachingToolContext, "course" | "management">,
): AgentTool {
  return {
    name: "create_course",
    label: "建立课程",
    description:
      "Create the course record before teaching when there is no active course. Choose a concise title and a stable learning topic from the student's request.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 80 }),
      topic: Type.String({ minLength: 1, maxLength: 240 }),
      cover: Type.Object({
        motif: Type.Union([
          Type.Literal("code"),
          Type.Literal("orbit"),
          Type.Literal("geometry"),
          Type.Literal("language"),
          Type.Literal("nature"),
          Type.Literal("history"),
          Type.Literal("abstract"),
        ]),
        palette: Type.Union([
          Type.Literal("sprout"),
          Type.Literal("sunrise"),
          Type.Literal("ocean"),
          Type.Literal("berry"),
          Type.Literal("clay"),
        ]),
        label: Type.String({ minLength: 1, maxLength: 32 }),
      }),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const input = params as {
        title: string;
        topic: string;
        cover: CourseCover;
      };
      if (!context.course.id) {
        const created = await context.management.create(
          String(input.title),
          String(input.topic),
          input.cover,
        );
        context.course.id = created.id;
        context.course.title = created.title;
        context.course.topic = created.topic;
      }
      return {
        content: [
          {
            type: "text",
            text: `The active course is ${JSON.stringify({ id: context.course.id, title: context.course.title, topic: context.course.topic })}.`,
          },
        ],
        details: { courseId: context.course.id },
      };
    },
  };
}
