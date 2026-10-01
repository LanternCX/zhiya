import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { CodingTools } from "../tool";

export const activityLabel = "读取编程语言";

export function listCodingLanguagesTool(
  languages: CodingTools["languages"],
): AgentTool {
  return {
    name: "list_coding_languages",
    label: "列出编程语言",
    description:
      "List the programming languages and exact language IDs currently available in the code runner. Call this before creating an exercise unless a current tool result already provides the list.",
    parameters: Type.Object({}),
    execute: async () => {
      const available = await languages();
      return {
        content: [{ type: "text", text: JSON.stringify(available) }],
        details: { languages: available.length },
      };
    },
  };
}
