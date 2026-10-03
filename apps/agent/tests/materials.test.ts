import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("material tool exposes stable line references and preserves incomplete-source warnings", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zhiya-material-tool-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outfile = join(directory, "tool.mjs");
  await build({ entryPoints: ["src/pi/tools/read_course_material.ts"], bundle: true, outfile, platform: "node", format: "esm" });
  const { readCourseMaterialTool } = await import(pathToFileURL(outfile).href);
  const tool = readCourseMaterialTool({
    course: { id: "course" },
    management: {
      readMaterial: async (id: string, range: object) => {
        assert.equal(id, "material");
        assert.deepEqual(range, { startLine: 2, endLine: 3, revision: 4 });
        return {
          material: { id, name: "教材.ppt" }, revision: 4,
          excerpt: { status: "partial", totalLines: 8, nextLine: 4, warnings: ["第 2 页图像无法辨认"], lines: [
            { number: 2, text: "变量保存数据", kind: "text", source: { slide: 1 } },
            { number: 3, text: "箭头指向输出", kind: "description", source: { slide: 1, image: "page:1" } },
          ] },
        };
      },
    },
  });
  const output = await tool.execute("read", { materialId: "material", startLine: 2, endLine: 3, revision: 4 });
  assert.match(output.content[0].text, /L2.*变量保存数据/);
  assert.match(output.content[0].text, /第 2 页图像无法辨认/);
  assert.match(output.content[0].text, /description/);
  assert.ok(output.content[0].text.includes("[教材.ppt](#material/material/4/2-3)"));
  assert.match(tool.description, /#material/);
  assert.deepEqual(output.details.reference, { materialId: "material", revision: 4, startLine: 2, endLine: 3 });
  assert.equal(output.details.nextLine, 4);
});
