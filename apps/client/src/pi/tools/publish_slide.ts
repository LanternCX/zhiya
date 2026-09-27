import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { Slide } from "../../domain/learning";

function validateSlide(title: string, markdown: string) {
  const lines = markdown.trim().split(/\r?\n/);
  if (lines[0] !== `# ${title}`)
    throw new Error("Start the slide with one # heading matching its title.");

  let inCode = false;
  let codeBlocks = 0;
  let codeLines = 0;
  let bullets = 0;
  let tableRows = 0;

  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (!inCode) {
        if (!/^```[a-zA-Z][\w+-]*$/.test(trimmed))
          throw new Error("Tag each code block with its programming language.");
        codeBlocks++;
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeLines++;
      if ([...line].length > 60)
        throw new Error("Keep code lines under 60 characters.");
      continue;
    }
    if (/<!--|^<\/?[a-z][\w-]*(?:\s|>|\/)/i.test(trimmed) || /!?\[[^\]]*\]\([^)]*\)/.test(line))
      throw new Error("Do not include HTML, Marp directives, links, or images.");
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed))
      throw new Error("Publish only one slide per tool call.");
    if (/^#\s/.test(trimmed))
      throw new Error("Use only one level-one heading per slide.");
    if (/^(?:[-*+]\s|\d+[.)]\s)/.test(trimmed)) bullets++;
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      tableRows++;
      if (trimmed.split("|").length - 2 > 3)
        throw new Error("Keep tables to at most three columns.");
    }
  }

  if (inCode || codeBlocks > 1 || codeLines > 8)
    throw new Error("Use one complete language-tagged code block of at most eight lines.");
  if (bullets > (codeBlocks ? 2 : 5))
    throw new Error("Reduce the number of points on this slide.");
  if (tableRows > 6 || (tableRows > 0 && codeBlocks > 0))
    throw new Error("Use a small table or a code block, not both.");
}

/** Publication succeeds only when the active generation accepts the page. */
export function publishSlideTool(
  publish: (id: string, page: Omit<Slide, "id" | "kind">) => number,
): AgentTool {
  return {
    name: "publish_slide",
    label: "发布课件页",
    description:
      "Publish exactly one completed slide asset. This makes the next requested slide available and releases any wait for it, but does not present it. The teacher chooses when to teach each page.",
    parameters: Type.Object({
      title: Type.String({
        maxLength: 32,
        description: "Plain-text page title.",
      }),
      markdown: Type.String({
        minLength: 1,
        maxLength: 1200,
        description:
          "Markdown for exactly one slide. Start with a level-one heading matching title; use concise prose, short lists, a small table, or one fenced code block with a language. Describe sample output in prose, not a second fence. No YAML, slide separators, HTML, CSS, scripts, Marp directives, images, or links.",
      }),
    }),
    executionMode: "sequential",
    execute: async (id, params) => {
      const page = params as Omit<Slide, "id" | "kind">;
      validateSlide(page.title, page.markdown);
      const count = publish(id, page);
      return {
        content: [
          { type: "text", text: `Page ${count} is ready for the teacher.` },
        ],
        details: { page: count },
      };
    },
  };
}
