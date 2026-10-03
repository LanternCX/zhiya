import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import JSZip from "jszip";

test("exports Chinese source, tables, code and embedded pictures into real Office files", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zhiya-exports-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "export.cjs");
  await build({
    entryPoints: ["src/features/deliverables/export.ts"],
    outfile: path,
    bundle: true,
    platform: "node",
    format: "cjs",
  });
  const { exportDeliverable } = createRequire(import.meta.url)(path);
  const source = {
    id: "example",
    title: "人工智能讲义",
    revision: 2,
    updatedAt: "2026-10-03",
    blocks: [
      {
        id: "intro",
        title: "生活中的人工智能",
        markdown:
          "语音助手帮助我们查询天气。\n\n| 输入 | 输出 |\n| --- | --- |\n| 问题 | 回答 |\n\n```python\nprint(42)\n```",
        imageIds: ["picture"],
      },
    ],
  };
  const picture =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAJklEQVR4nGP0ro1ioCVgoqnpoxaMWjBqwagFoxaMWjBqwagFVAMALtoBUr9C5zIAAAAASUVORK5CYII=";
  for (const kind of ["presentation", "document"]) {
    const file = await exportDeliverable({ ...source, kind }, async () => ({
      data: picture,
      width: 32,
      height: 24,
    }));
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    assert.ok(zip.file("[Content_Types].xml"));
    const names = Object.keys(zip.files);
    const text = (
      await Promise.all(
        names
          .filter((n) => /(?:slides\/slide\d+|word\/document)\.xml$/.test(n))
          .map((n) => zip.file(n)!.async("string")),
      )
    ).join("\n");
    assert.match(text, /生活中的人工智能/);
    assert.match(text, /语音助手帮助我们查询天气/);
    assert.match(text, /输入/);
    assert.match(text, /print\(42\)/);
    assert.ok(
      names.some((n) => /media\/.+\.png$/.test(n)),
      "image must be embedded",
    );
    const relationships = (
      await Promise.all(
        names
          .filter((n) => n.endsWith(".rels"))
          .map((n) => zip.file(n)!.async("string")),
      )
    ).join("\n");
    assert.doesNotMatch(relationships, /TargetMode="External"/);
  }
});

test("classroom diagrams are exported as static editable shapes and connections", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zhiya-diagram-export-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "export.cjs");
  await build({ entryPoints: ["src/features/deliverables/export.ts"], outfile: path, bundle: true, platform: "node", format: "cjs" });
  const { exportDeliverable } = createRequire(import.meta.url)(path);
  const file = await exportDeliverable({ id: "classroom", kind: "presentation", title: "流程", revision: 1, blocks: [{ id: "map", title: "编译流程", markdown: "", imageIds: [], diagram: { layout: "horizontal", nodes: [{ id: "group", shape: "group", label: "编译过程" }, { id: "code", shape: "rectangle", label: "源代码", groupId: "group" }, { id: "binary", shape: "rectangle", label: "可执行文件" }], edges: [{ id: "compile", source: "code", target: "binary", label: "编译" }], highlightedIds: ["code"], flowingIds: ["compile"] } }] }, async () => { throw new Error("diagram needs no external image"); });
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(xml, /源代码/);
  assert.match(xml, /可执行文件/);
  assert.match(xml, /编译/);
  assert.match(xml, /编译过程/);
  assert.match(xml, /prst="line"/);
  assert.match(xml, /2F7D50/);
  assert.match(xml, /<a:prstDash val="dash"/);
  assert.match(xml, /<a:tailEnd type="triangle"/);
  assert.doesNotMatch(xml, /<p:(?:transition|timing)\b/);
});
