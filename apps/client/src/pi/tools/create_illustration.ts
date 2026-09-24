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
      "Start exactly one independent 16:9 teaching-image task and return after submission. Call this tool once per requested image; multiple calls in the same turn run in parallel. Do not add slides or animations merely to balance an image request. The image may be a picture-book scene, explanatory illustration, visual mind map, simple diagram, lightly labeled visual slide, or artwork that accompanies a text slide. Choose the most fitting 2D style, such as watercolor, colored pencil, flat vector, hand-drawn diagram, or comics when storytelling calls for them; avoid 3D renders. Describe the subject, action or relationships, composition, palette, and any recurring character details. A few short Chinese words may appear when they help the picture; give the exact words in the description, avoid dense labels or paragraphs, and leave precise titles, formulas, and longer explanations to the app's text. Do not request watermarks or logos. Use a unique pageId. Each completed page enters only the unordered buffer and stays hidden until the teacher explicitly moves it into the display sequence and show_lesson_page succeeds; it can be cancelled or replaced independently.",
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
            text: `Illustration task started: ${JSON.stringify(task)}. Continue teaching without waiting for it.`,
          },
        ],
        details: task,
      };
    },
  };
}
