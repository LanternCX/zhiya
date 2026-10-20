import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { IllustrationTools } from "../tool";

export const activityLabel = "绘制教学插图";

export function createIllustrationTool(
  start: IllustrationTools["start"],
): AgentTool {
  return {
    name: "create_illustration",
    label: activityLabel,
    description:
      "Start exactly one independent 16:9 teaching-image task and return after submission. Call this tool once per requested image; multiple calls in the same turn run in parallel. Use for picture-book scenes, explanatory artwork, or imagery accompanying text slides. For flowcharts, mind maps and node-link diagrams, use create_animation instead so the app controls structure and layout. The image service supplies a shared style reference, so focus the description on the current teaching subject, composition, and recurring character details. Keep the result clear and 2D; avoid 3D renders. A few short Chinese words may appear when they help the picture; give the exact words, avoid dense labels or paragraphs, and leave formulas and longer explanations to text. Do not request watermarks or logos. Use a unique pageId. Each page stays hidden until show_lesson_page succeeds. Tasks can be cancelled independently.",
    parameters: Type.Object({
      pageId: Type.String({ minLength: 1, maxLength: 64 }),
      title: Type.String({ minLength: 1, maxLength: 100 }),
      description: Type.String({ minLength: 1, maxLength: 1000 }),
      alt: Type.String({ minLength: 1, maxLength: 300 }),
    }),
    executionMode: "parallel",
    execute: async (_id, params) => {
      const task = await start(
        params as {
          pageId: string;
          title: string;
          description: string;
          alt: string;
        },
      );
      return {
        content: [
          {
            type: "text",
            text: `Illustration task started: ${JSON.stringify(task)}. You can do independent teaching now, or call show_lesson_page to wait for and teach this page. Completion alone never presents it.`,
          },
        ],
        details: task,
      };
    },
  };
}
