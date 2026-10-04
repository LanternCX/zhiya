import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { createHash } from "node:crypto";
import type { LessonPage } from "../../../../../packages/learning/src/domain/learning";
import type { LessonPageTools } from "../tool";

const fields = {
  slide: ["title", "markdown"],
  illustration: ["title", "alt"],
  question: ["title", "text"],
  coding: ["title", "instructions", "starterCode"],
  animation: ["title"],
  video: ["topic"],
} as const;

export function readEditablePage(page: LessonPage) {
  const editableFields: string[] = [...fields[page.kind]];
  // Student interaction does not invalidate content edits or leak into source.
  const source = Object.fromEntries(editableFields.map((field) => [field, Reflect.get(page, field)]));
  const version = createHash("sha256").update(JSON.stringify([page.id, page.kind, source])).digest("hex");
  const safe = structuredClone(page);
  if (safe.kind === "coding") { safe.code = safe.starterCode; safe.stdin = ""; delete safe.result; }
  if (safe.kind === "question") { safe.selected = []; safe.answerText = ""; }
  return { page: safe, version, editableFields };
}

export function patchClassroomPage(page: LessonPage, version: string, changes: Array<{ field: string; oldText: string; newText: string }>) {
  const before = readEditablePage(page);
  if (before.version !== version) throw new Error("课堂源内容已变化，请重新读取后修改");
  if (!changes.length || changes.length > 30) throw new Error("请提供 1–30 处局部修改");
  const groups = new Map<string, Array<{ start: number; end: number; newText: string }>>();
  for (const change of changes) {
    if (!before.editableFields.includes(change.field)) throw new Error(`字段 ${change.field} 不可修改`);
    const source: string = Reflect.get(page, change.field);
    if (!change.oldText) throw new Error("oldText 不能为空；请提供能够唯一定位修改位置的原文");
    const start = source.indexOf(change.oldText);
    if (start < 0) throw new Error(`字段 ${change.field} 中找不到原文，请重新读取`);
    if (source.indexOf(change.oldText, start + 1) >= 0) throw new Error(`字段 ${change.field} 中原文匹配多处，请增加上下文`);
    const regions = groups.get(change.field) ?? [];
    const end = start + change.oldText.length;
    if (regions.some((region) => start < region.end && end > region.start)) throw new Error("同一次修改的原文范围不能重叠");
    regions.push({ start, end, newText: change.newText });
    groups.set(change.field, regions);
  }
  const updated = structuredClone(page);
  for (const [field, regions] of groups) {
    let source: string = Reflect.get(page, field);
    for (const region of regions.sort((a, b) => b.start - a.start)) source = source.slice(0, region.start) + region.newText + source.slice(region.end);
    if (source.length > 24000 || (field === "title" && (!source.trim() || source.length > 120))) throw new Error("修改后的内容为空或过长");
    Reflect.set(updated, field, source);
  }
  return { ...readEditablePage(updated), updated, diff: changes };
}

export function classroomEditTools(pages: LessonPageTools): AgentTool[] {
  const result = (details: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(details) }], details });
  return [
    {
      name: "read_classroom_page", label: "读取课堂源内容",
      description: "Read one page in the current conversation, its editable fields and content version. Use block.source.pageId from a course download, or read_lesson_pages. This is the authoritative source for classroom, PPT and course document. Student answers and working code are excluded.",
      parameters: Type.Object({ pageId: Type.String() }),
      executionMode: "sequential",
      execute: async (_id, params) => result(pages.readPage((params as { pageId: string }).pageId)),
    },
    {
      name: "edit_classroom_page", label: "修改课堂源内容",
      description: "Apply minimal old-text/new-text edits to one current classroom page, using a version from read_classroom_page. Every oldText must match exactly one non-overlapping region of the original field. All changes are validated before applying; any failure leaves source untouched. Read again on version or matching errors. Retains identity, pictures and student interaction; updates both Office downloads without making copies.",
      parameters: Type.Object({ pageId: Type.String(), version: Type.String(), changes: Type.Array(Type.Object({ field: Type.String(), oldText: Type.String({ minLength: 1 }), newText: Type.String() }), { minItems: 1, maxItems: 30 }) }),
      executionMode: "sequential",
      execute: async (_id, params, signal) => {
        signal?.throwIfAborted();
        const { pageId, version, changes } = params as { pageId: string; version: string; changes: Array<{ field: string; oldText: string; newText: string }> };
        return result(pages.patch(pageId, version, changes));
      },
    },
  ];
}
