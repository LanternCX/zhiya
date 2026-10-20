import assert from "node:assert/strict";
import test from "node:test";
import { layoutDiagram } from "../src/features/course/diagram-layout.ts";

test("grouped cycles preserve every node, full labels and routed edges without overlapping siblings", async () => {
  const nodes = [
    { id: "g", shape: "group", label: "处理过程" },
    { id: "a", shape: "rectangle", label: "很长的中文说明".repeat(10), groupId: "g" },
    { id: "b", shape: "diamond", label: "通过了吗", groupId: "g" },
    { id: "c", shape: "rectangle", label: "完成" },
  ] as const;
  const result = await layoutDiagram({ layout: "vertical", nodes: [...nodes], edges: [
    { id: "ab", source: "a", target: "b", label: "检查" },
    { id: "ba", source: "b", target: "a", label: "重试" },
    { id: "bc", source: "b", target: "c", label: "通过" },
  ] });
  assert.equal(result.nodes.length, 4);
  const [a, b, c] = ["a", "b", "c"].map(id => result.nodes.find(n => n.id === id)!);
  for (const [one, two] of [[a, b], [a, c], [b, c]])
    assert.ok(one.x + one.width <= two.x || two.x + two.width <= one.x ||
      one.y + one.height <= two.y || two.y + two.height <= one.y);
  assert.equal(a.lines.join(""), nodes[1].label);
  for (const edge of result.edges) {
    assert.ok(edge.points.length >= 2);
    const [source, target] = ({ ab: [a, b], ba: [b, a], bc: [b, c] })[edge.id]!;
    for (const [point, box] of [[edge.points[0], source], [edge.points.at(-1)!, target]] as const) {
      assert.ok(point.x >= box.x - 0.01 && point.x <= box.x + box.width + 0.01 &&
        point.y >= box.y - 0.01 && point.y <= box.y + box.height + 0.01,
        `${edge.id} must terminate on its node, including inside a group`);
    }
  }
  for (const edge of result.edges) {
    const point = edge.id === "ab" ? edge.points.at(-1)! : edge.points[0];
    const diamondDistance = Math.abs(point.x - b.x - b.width / 2) / (b.width / 2) +
      Math.abs(point.y - b.y - b.height / 2) / (b.height / 2);
    assert.ok(Math.abs(diamondDistance - 1) < 0.001, "edges meet the visible diamond outline");
  }
  assert.ok(result.width > 0 && result.height > 0);
});

test("self-loops, disconnected nodes and reversed input order retain their relationships", async () => {
  const result = await layoutDiagram({
    layout: "horizontal",
    nodes: ["end", "alone", "start"].map(id => ({ id, label: id, shape: "rectangle" as const })),
    edges: [{ id: "forward", source: "start", target: "end" }, { id: "loop", source: "start", target: "start" }],
  });
  assert.ok(result.nodes.find(n => n.id === "start")!.x < result.nodes.find(n => n.id === "end")!.x);
  assert.equal(result.nodes.length, 3);
  assert.ok(result.edges.find(e => e.id === "loop")!.points.length > 2);
});

test("animation reserves room for later node and edge labels before playback", async () => {
  const value = "长文字".repeat(26);
  const result = await layoutDiagram({
    layout: "horizontal",
    nodes: [{ id: "a", shape: "rectangle", label: "开始" }, { id: "b", shape: "rectangle", label: "结束" }],
    edges: [{ id: "edge", source: "a", target: "b" }],
    buttons: [{ id: "play", label: "显示", steps: [[
      { type: "update", targetId: "a", value },
      { type: "update", targetId: "edge", value },
    ]] }],
  });
  assert.ok(result.nodes.find(n => n.id === "a")!.height >= 6 * 24 + 32);
  assert.ok(result.edges[0].label!.height >= 7 * 24);
});
