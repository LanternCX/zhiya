import { Type } from "typebox";
import { bindPersistedTool, type PersistedToolExecutor } from "../tool";

export function updateMemoryTool(
  execute: PersistedToolExecutor,
  canUpdateMemory: () => boolean,
) {
  return bindPersistedTool(
    {
      name: "update_memory",
      label: "update_memory",
      description:
        "Replace Markdown memory using its current version. An empty document removes the memory; conversation history is separate.",
      parameters: Type.Object({ content: Type.String(), version: Type.Integer() }),
    },
    async (id) => {
      if (!canUpdateMemory())
        throw new Error(
          "Ask the student with ask_student and wait for their answer before updating memory.",
        );
      return execute(id);
    },
  );
}
