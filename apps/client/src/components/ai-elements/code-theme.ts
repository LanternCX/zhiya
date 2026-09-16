import { createCodePlugin } from "@streamdown/code";

// Keep message and reasoning code blocks on the same VS Code theme pair.
export const code = createCodePlugin({ themes: ["light-plus", "dark-plus"] });
