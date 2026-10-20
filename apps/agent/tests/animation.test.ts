import assert from "node:assert/strict";
import test from "node:test";
import { publishAnimationTool } from "../src/pi/tools/publish_animation.ts";

test("publishing rejects edges referring to an edge instead of a node", async () => {
  let published = false;
  const tool = publishAnimationTool(() => { published = true; });
  await assert.rejects(() => tool.execute("call", {
    pageId: "flow", title: "流程", layout: "vertical",
    nodes: [{ id: "a", shape: "rectangle", label: "开始" }],
    edges: [
      { id: "loop", source: "a", target: "a" },
      { id: "invalid", source: "loop", target: "a" },
    ],
    buttons: [],
  }), /invalid.*不存在/);
  assert.equal(published, false);
});

test("static cycles publish, while invalid grouping and animation targets are rejected", async () => {
  const published: unknown[] = [];
  const tool = publishAnimationTool(page => published.push(page));
  const page = {
    pageId: "cycle", title: "重试", layout: "vertical",
    nodes: [{ id: "a", shape: "rectangle", label: "处理" }, { id: "b", shape: "diamond", label: "完成？" }],
    edges: [{ id: "ab", source: "a", target: "b" }, { id: "ba", source: "b", target: "a" }],
    buttons: [],
  };
  await tool.execute("valid", page);
  assert.equal(published.length, 1);
  for (const nodes of [
    [...page.nodes, page.nodes[0]],
    [{ ...page.nodes[0], groupId: "b" }, page.nodes[1]],
    [{ id: "g", shape: "group", label: "组", groupId: "g" }, ...page.nodes],
  ]) await assert.rejects(() => tool.execute("invalid", { ...page, nodes }), /重复|分组/);
  await assert.rejects(() => tool.execute("flow", { ...page, buttons: [
    { id: "run", label: "运行", steps: [[{ type: "flow", targetId: "a" }]] },
  ] }), /必须引用连线/);
  assert.equal(published.length, 1);
});
