import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { CodingTools } from "../tool";

export const activityLabel = "读取练习代码";

export function readCodingExerciseTool(read: CodingTools["read"]): AgentTool {
  return {
    name: "read_coding_exercise",
    label: "读取练习代码",
    description:
      "Read the student's current code. Use only when the student asks for help with the code.",
    parameters: Type.Object({}),
    execute: async () => {
      const exercise = read();
      return {
        content: [{ type: "text", text: JSON.stringify(exercise) }],
        details: { exerciseId: exercise.id },
      };
    },
  };
}
