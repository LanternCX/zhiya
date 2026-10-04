import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type {
  Deliverable,
  DeliverableBlock,
  DeliverableChange,
  DeliverableSelection,
} from "../../../../../packages/learning/src/domain/deliverable";

export type DeliverableTools = {
  list(): Promise<Deliverable[]>;
  read(id: string): Promise<Deliverable>;
  selection(): DeliverableSelection | null;
  write(
    id: string,
    input: {
      requestId: string;
      kind?: Deliverable["kind"];
      title?: string;
      blocks?: DeliverableBlock[];
      revision?: number;
      changes?: DeliverableChange[];
    },
    signal?: AbortSignal,
  ): Promise<Deliverable>;
};

const block = Type.Object({
  id: Type.String({
    description:
      "Stable ASCII ID, such as intro or page-2. Keep it when editing.",
  }),
  title: Type.String({ maxLength: 120 }),
  markdown: Type.String({
    description:
      "Body Markdown, without a duplicate page title, front matter, HTML or slide separators. Use short readable text, lists, tables or fenced code. Insert pictures through imageIds, never Markdown image URLs.",
  }),
  imageIds: Type.Array(Type.String(), {
    maxItems: 4,
    description:
      "Existing completed illustration asset IDs, or imported image IDs returned by read_deliverable. Do not invent IDs.",
  }),
});

export function deliverableTools(storage: DeliverableTools): AgentTool[] {
  const result = (details: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  });
  return [
    {
      name: "list_deliverables",
      label: "查看交付产物",
      description:
        "List the current course's automatic classroom presentation and course document, plus imported slide materials and authored documents. classroom is derived from printable classroom content; course-document includes objectives, teaching content and explanations. They always exist once the course exists. Never create a duplicate presentation for download.",
      parameters: Type.Object({}),
      execute: async () =>
        result(
          (await storage.list()).map(
            ({ id, kind, title, revision, blocks, source }) => ({
              id,
              kind,
              title,
              revision,
              source,
              blocks: blocks.map(({ id, title, source }) => ({ id, title, source })),
            }),
          ),
        ),
    },
    {
      name: "read_deliverable",
      label: "读取交付产物",
      description:
        "Read source, stable block IDs, image IDs and content version. classroom and course-document are derived views: block.source locates the authoritative classroom page or material. Edit classroom pages with read_classroom_page/edit_classroom_page; course goals with set_course_outline; authored/imported sources with edit_deliverable. A source update appears in both downloads automatically.",
      parameters: Type.Object({ id: Type.String(), blockIds: Type.Optional(Type.Array(Type.String(), { minItems: 1 })) }),
      execute: async (_id, params) => {
        const { id, blockIds } = params as { id: string; blockIds?: string[] };
        const item = await storage.read(id);
        if (!blockIds) return result(item);
        if (blockIds.some((id) => !item.blocks.some((block) => block.id === id))) throw new Error("未找到请求的页面或章节");
        return result({ ...item, totalBlocks: item.blocks.length, blocks: item.blocks.filter((block) => blockIds.includes(block.id)) });
      },
    },
    {
      name: "create_deliverable",
      label: "制作交付产物",
      description:
        "Create an additional document, for example a tutorial, handout, worksheet or teacher preparation notes. It is available on its own and included in the automatic course document. Ordinary teaching already provides a presentation and course document, without this call. For PPT content use classroom slide/illustration/question/coding tools, not a second presentation. Supply actual content and confirm success before claiming delivery.",
      executionMode: "sequential",
      parameters: Type.Object({
        kind: Type.Literal("document"),
        title: Type.String({ maxLength: 120 }),
        blocks: Type.Array(block, { minItems: 1, maxItems: 100 }),
      }),
      execute: async (id, params, signal) => {
        signal?.throwIfAborted();
        return result(
          await storage.write(
            "",
            {
              ...(params as {
                kind: Deliverable["kind"];
                title: string;
                blocks: DeliverableBlock[];
              }),
              requestId: id,
            },
            signal,
          ),
        );
      },
    },
    {
      name: "edit_deliverable",
      label: "修改交付产物",
      description:
        "Edit an authored document or imported slide source by stable block ID and revision. For precise edits, patch title/markdown with unique oldText/newText; all patch matches use the original source and must not overlap. Use replace only for an intentional complete rewrite, insert for new content, remove/move for structure. insert/move uses afterId or empty for the beginning. All changes commit together or leave source untouched. On mismatch/conflict read again. Do not edit derived classroom/course-document views: locate block.source and edit that source instead.",
      executionMode: "sequential",
      parameters: Type.Object({
        id: Type.String(),
        revision: Type.Integer({ minimum: 1 }),
        title: Type.Optional(Type.String({ maxLength: 120 })),
        changes: Type.Array(
          Type.Union([
            Type.Object({ action: Type.Literal("patch"), blockId: Type.String(), field: Type.Union([Type.Literal("title"),Type.Literal("markdown")]), oldText: Type.String({ minLength: 1 }), newText: Type.String() }),
            Type.Object({ action: Type.Union([Type.Literal("insert"),Type.Literal("replace")]), blockId: Type.String(), afterId: Type.Optional(Type.String()), block }),
            Type.Object({ action: Type.Literal("remove"), blockId: Type.String() }),
            Type.Object({ action: Type.Literal("move"), blockId: Type.String(), afterId: Type.String() }),
          ]),
        ),
      }),
      execute: async (id, params, signal) => {
        signal?.throwIfAborted();
        const { id: target, ...input } = params as {
          id: string;
          revision: number;
          title?: string;
          changes: DeliverableChange[];
        };
        const saved = await storage.write(target, { ...input, requestId: id }, signal);
        return result({ id: saved.id, title: saved.title, revision: saved.revision, diff: input.changes });
      },
    },
  ];
}
