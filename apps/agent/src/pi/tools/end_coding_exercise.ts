import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { CodingTools } from "../tool";

export const activityLabel = "结束编程练习";

export function endCodingExerciseTool(end: CodingTools["end"]): AgentTool {
  return {
    name: "end_coding_exercise",
    label: "结束编程练习",
    description:
      "End the active coding exercise and read its final code for a concise teaching review. Use when the student ends it or when teaching has clearly moved to another topic.",
    parameters: Type.Object({}),
    execute: async () => {
      const exercise = end();
      return {
        content: [{ type: "text", text: JSON.stringify(exercise) }],
        details: { exerciseId: exercise.id },
      };
    },
  };
}
