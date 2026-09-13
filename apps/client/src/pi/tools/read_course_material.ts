import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { TeachingToolContext } from "../tool";

export const activityLabel = "读取课程材料";

export function readCourseMaterialTool(
  context: Pick<TeachingToolContext, "course" | "management">,
): AgentTool {
  return {
    name: "read_course_material",
    label: activityLabel,
    description:
      "Read one relevant course material by ID in bounded chunks. Uploaded materials are references unless the student explicitly asks to organize the course around one of them. Continue from nextOffset only when more of the material is needed.",
    parameters: Type.Object({
      materialId: Type.String({ minLength: 1 }),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      if (!context.course.id) throw new Error("课程尚未建立");
      const input = params as { materialId: string; offset?: number };
      const { material, content } = await context.management.readMaterial(
        String(input.materialId),
      );
      const characters = Array.from(content);
      const offset = Math.min(input.offset ?? 0, characters.length);
      const end = Math.min(offset + 12_000, characters.length);
      const nextOffset = end < characters.length ? end : null;
      return {
        content: [
          {
            type: "text",
            text: `Course material ${JSON.stringify(material.name)} characters ${offset}-${end} of ${characters.length}:\n\n${characters.slice(offset, end).join("")}\n\nnextOffset: ${nextOffset ?? "end"}`,
          },
        ],
        details: { materialId: material.id, offset, nextOffset },
      };
    },
  };
}
