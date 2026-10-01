import { Type } from "typebox";
import { bindPersistedTool, type PersistedToolExecutor } from "../tool";

export function readMemoryTool(execute: PersistedToolExecutor) {
  return bindPersistedTool(
    {
      name: "read_memory",
      label: "read_memory",
      description:
        "Read this student's current Markdown memory and version.",
      parameters: Type.Object({}),
    },
    execute,
  );
}
