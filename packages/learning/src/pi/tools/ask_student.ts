import { Type } from "typebox";
import { bindPersistedTool, type PersistedToolExecutor } from "../tool";

export function askStudentTool(execute: PersistedToolExecutor) {
  return bindPersistedTool(
    {
      name: "ask_student",
      label: "ask_student",
      description:
        "Ask one question and wait for the student's answer. Other devices can answer it.",
      parameters: Type.Object({
        text: Type.String(),
        description: Type.Optional(Type.String()),
        kind: Type.Union([
          Type.Literal("single"),
          Type.Literal("multiple"),
          Type.Literal("text"),
        ]),
        options: Type.Array(Type.String()),
      }),
    },
    execute,
  );
}
