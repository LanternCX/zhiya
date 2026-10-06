import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("knowledge tools search, read source evidence and preserve failure semantics", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zhiya-knowledge-tools-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "tools.mjs");
  await build({
    entryPoints: ["src/pi/tools/knowledge.ts"],
    bundle: true,
    outfile: file,
    platform: "node",
    format: "esm",
  });
  const { knowledgeTools } = await import(file);
  const source = {
    version: "a".repeat(64),
    blockId: "doc-page-1",
    documentId: "doc",
    title: "训练数据",
    text: "模型从样本学习",
    modality: "image",
    location: { page: 1 },
    reviewStatus: "unreviewed",
    warnings: [],
    citation: `[训练数据](#knowledge/${"a".repeat(64)}/doc-page-1)`,
    score: 0.8,
    hasAsset: true,
  };
  let query = "";
  const [search, read] = knowledgeTools({
    search: async (q: string) => {
      query = q;
      return { query: q, sources: [source] };
    },
    read: async () => ({
      ...source,
      visual: {
        transcription: "训练样本",
        description: "猫和狗分类图",
        warnings: [],
      },
    }),
  });
  const found = await search.execute("search", { query: "训练数据是什么" });
  assert.equal(query, "训练数据是什么");
  assert.match(found.content[0].text, /#knowledge\//);
  const evidence = await read.execute("read", {
    version: source.version,
    blockId: source.blockId,
  });
  assert.match(evidence.content[0].text, /猫和狗分类图/);
  const [failed] = knowledgeTools({
    search: async () => {
      throw Error("向量服务不可用");
    },
    read: async () => source,
  });
  await assert.rejects(
    failed.execute("failed", { query: "数据" }),
    /向量服务不可用/,
  );
});
