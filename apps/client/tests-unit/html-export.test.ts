import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

test("diagram SVG keeps full escaped labels and directional cycle routes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zhiya-svg-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "svg.cjs");
  await build({ entryPoints: ["src/features/course/diagram-svg.ts"], outfile: path, bundle: true, platform: "node", format: "cjs" });
  const { diagramSVG } = createRequire(import.meta.url)(path);
  const label = "<脚本>&".repeat(12);
  const svg = await diagramSVG({
    layout: "vertical",
    nodes: [{ id: "a", shape: "rectangle", label }, { id: "b", shape: "diamond", label: "完成？" }],
    edges: [{ id: "ab", source: "a", target: "b" }, { id: "ba", source: "b", target: "a", label: "重试" }],
  });
  assert.doesNotMatch(svg, /<脚本>/);
  assert.equal((svg.replace(/<\/?tspan[^>]*>/g, "").match(/&lt;脚本&gt;&amp;/g) ?? []).length, 12);
  assert.match(svg, /重试/);
  assert.equal((svg.match(/rotate\(/g) ?? []).length, 2);
});

test("HTML export embeds content and pictures without external resources or executable source markup", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zhiya-html-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "html.cjs");
  await build({
    entryPoints: ["src/features/deliverables/html.ts"],
    outfile: path,
    bundle: true,
    platform: "node",
    format: "cjs",
    loader: { ".css": "text" },
  });
  const { exportHTML } = createRequire(import.meta.url)(path);
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const source = {
    id: "example",
    kind: "presentation",
    title: '<img src=x onerror="alert(1)">',
    revision: 1,
    updatedAt: "2026-10-05",
    blocks: [
      {
        id: "intro",
        title: "认识 AI",
        markdown:
          "中文讲解\n\n<script>alert(1)</script>\n\n![outside](https://example.com/a.png)\n\n| 输入 | 输出 |\n| --- | --- |\n| 图片 | 分类 |",
        imageIds: ["picture"],
      },
    ],
  };
  const blob = await exportHTML(source, async () => ({
    data: image,
    width: 32,
    height: 24,
  }));
  const html = await blob.text();
  assert.match(blob.type, /text\/html/);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<style>/);
  assert.match(html, /中文讲解/);
  assert.match(html, /<table>/);
  assert.ok(html.includes(image));
  assert.match(html, /<img[^>]*width="32"[^>]*height="24"/);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes('src="https:'));
  assert.match(html, /下一页/);
  await assert.rejects(
    exportHTML(source, async () => {
      throw new Error("图片读取失败");
    }),
    /图片读取失败/,
  );
});
