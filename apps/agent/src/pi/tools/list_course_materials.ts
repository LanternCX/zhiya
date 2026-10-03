import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { TeachingToolContext } from "../tool";

export const activityLabel = "查看课程材料";

export function listCourseMaterialsTool(
  context: Pick<TeachingToolContext, "course" | "management">,
): AgentTool {
  return {
    name: "list_course_materials",
    label: activityLabel,
    description:
      "List shared course materials and their parseStatus and parseRevision. Text, Office, PDF and image materials all have a parsed copy. Read ready or partial materials as needed; partial means content may be missing. Pending/processing materials are not yet readable. Do not repeatedly poll or assume every material must be read.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async () => {
      if (!context.course.id) throw new Error("课程尚未建立");
      const materials = await context.management.listMaterials();
      return {
        content: [{ type: "text", text: JSON.stringify(materials) }],
        details: { count: materials.length },
      };
    },
  };
}
