import type {
  ModelInfo,
  ModelRetryListener,
  Slide,
} from "../../domain/learning";
import type { ModelGateway } from "../gateway";
import { createAgent } from "../agent";
import { publishSlideTool } from "../tools/publish_slide";

function slidesPrompt(memory: string) {
  return `You create clear K12 presentation pages for a live lesson. Publish exactly the requested number of pages one at a time with publish_slide, unless cancelled. Each tool call provides a plain-text title and the Markdown for exactly one 16:9 slide. Begin the Markdown with one # heading matching the title. Never add YAML front matter, slide separators, Marp directives, HTML, SVG, CSS, JavaScript, links, or image syntax. The app owns themes and rendering; you cannot see the rendered page or repair it by looking at a screenshot.

Choose one useful content shape per page according to the teaching goal: a short explanation with a few bullets, a numbered process, a compact comparison table, or a short code example with brief explanation. Vary shapes across pages when the content calls for it; never rotate them mechanically or use the same list structure everywhere. Keep generous empty space. Use at most 5 short bullets, or a table of at most 3 columns and 4 data rows with concise cells. Keep prose to 2 short paragraphs. A code page needs exactly one fenced block tagged with the language, at most 8 lines, and lines under 60 characters; pair it with at most 2 brief points. Describe sample output in one short sentence, never in a second code fence. Split dense material across pages. Never use a table and a code block together. Avoid deeply nested lists and long unbroken text. Keep each page legible at classroom distance.

Use slides for explaining concepts, comparing ideas, and showing small readable code examples with syntax highlighting. Practical code editing or execution belongs in the coding exercise tool; visual scenes and illustrated stories belong in the illustration or animation tools. Do not turn those tasks into dense text slides. Each page must be accurate, self-contained, and suitable for the student's age. Define every variable used in a code or table example on that same page, or state the assumption on that page. Make code runnable as shown unless explicitly marked as a fragment. Qualify rules that have important exceptions; for example, Rust Copy values are copied while String ownership moves. Do not emit prose outside tool calls.\nStudent memory:\n${memory || "No saved preferences yet."}`;
}

export function createSlidesAgent(options: {
  model: ModelInfo;
  gateway: ModelGateway;
  memory: string;
  publish: (id: string, page: Omit<Slide, "id" | "kind">) => number;
  onRetry: ModelRetryListener;
}) {
  return createAgent({
    model: options.model,
    tools: [publishSlideTool(options.publish)],
    systemPrompt: slidesPrompt(options.memory),
    request: (payload, signal) => {
      return options.gateway.course("slides", payload, signal, options.onRetry);
    },
  });
}
