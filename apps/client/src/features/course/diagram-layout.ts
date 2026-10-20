import type { ElkNode } from "elkjs";
import type { AnimationPage } from "../../domain/learning";

type Diagram = Pick<AnimationPage, "nodes" | "edges" | "layout"> & Partial<Pick<AnimationPage, "buttons">>;
export type Box = { x: number; y: number; width: number; height: number };
export type DiagramLayout = {
  width: number; height: number;
  nodes: Array<Box & { id: string; lines: string[] }>;
  edges: Array<{ id: string; points: Array<{ x: number; y: number }>; label?: Box & { lines: string[] } }>;
};

// One full-width glyph per cell is deliberately conservative across installed fonts.
export function diagramLines(text: string, columns = 14): string[] {
  return text.split("\n").flatMap(line => {
    const chars = Array.from(line);
    return Array.from({ length: Math.max(1, Math.ceil(chars.length / columns)) },
      (_, index) => chars.slice(index * columns, (index + 1) * columns).join(""));
  });
}

export async function layoutDiagram(page: Diagram): Promise<DiagramLayout> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ELK();
  const nodeIds = new Set(page.nodes.map(n => n.id));
  const ids = [...nodeIds, ...page.edges.map(e => e.id)];
  if (nodeIds.size !== page.nodes.length || new Set(ids).size !== ids.length)
    throw new Error("图示对象 ID 重复");
  for (const edge of page.edges)
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) throw new Error(`连线 ${edge.id} 引用了不存在的图形`);
  for (const node of page.nodes)
    if (node.groupId && (node.shape === "group" || !page.nodes.some(g => g.id === node.groupId && g.shape === "group")))
      throw new Error(`图形 ${node.id} 的分组无效`);
  const labels = new Map(page.nodes.map(n => [n.id, diagramLines(n.label)]));
  const children: ElkNode[] = page.nodes.map(node => {
    const alternatives = [node.label, ...(page.buttons ?? []).flatMap(b => b.steps.flat())
      .filter(a => a.type === "update" && a.targetId === node.id).map(a => a.type === "update" ? a.value : "")];
    const lineCount = Math.max(...alternatives.map(text => diagramLines(text).length));
    const factor = node.shape === "diamond" ? 2 : node.shape === "circle" ? 1.5 : 1;
    return {
      id: node.id, width: 264 * factor, height: Math.max(82, lineCount * 24 + 32) * factor,
      ...(node.shape === "group" ? {
        children: [],
        layoutOptions: { "elk.padding": `[top=${lineCount * 24 + 32},left=32,bottom=32,right=32]` },
      } : {}),
    };
  });
  const byId = new Map(children.map(n => [n.id, n]));
  for (const node of page.nodes)
    if (node.groupId) byId.get(node.groupId)!.children!.push(byId.get(node.id)!);
  let rootId = "__diagram_root__";
  while (ids.includes(rootId)) rootId += "_";
  const root: ElkNode = await elk.layout({
    id: rootId,
    children: children.filter(n => !page.nodes.find(node => node.id === n.id)!.groupId),
    edges: page.edges.map(edge => ({
      id: edge.id, sources: [edge.source], targets: [edge.target],
      labels: edge.label || (page.buttons ?? []).some(b => b.steps.flat().some(a => a.type === "update" && a.targetId === edge.id))
        ? [{ text: edge.label ?? "", width: 220, height: Math.max(
          diagramLines(edge.label ?? "", 12).length,
          ...(page.buttons ?? []).flatMap(b => b.steps.flat()).filter(a => a.type === "update" && a.targetId === edge.id)
            .map(a => diagramLines(a.type === "update" ? a.value : "", 12).length),
        ) * 24 + 12 }] : [],
    })),
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": page.layout === "vertical" ? "DOWN" : "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "64",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.spacing.edgeNode": "28",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
    },
  });
  const result: DiagramLayout = { width: root.width!, height: root.height!, nodes: [], edges: [] };
  function collect(parent: ElkNode, x: number, y: number) {
    for (const child of parent.children ?? []) {
      const box = { id: child.id, x: x + child.x!, y: y + child.y!, width: child.width!, height: child.height!, lines: labels.get(child.id)! };
      result.nodes.push(box);
      collect(child, box.x, box.y);
    }
    for (const edge of parent.edges ?? []) {
      const section = edge.sections?.[0];
      if (!section) throw new Error(`无法排列连线 ${edge.id}`);
      const label = edge.labels?.[0];
      // ELK may store a compound edge on the root while its coordinates belong
      // to the named container. Resolve that origin for both paths and labels.
      const containerId = (edge as typeof edge & { container?: string }).container;
      const origin = containerId && containerId !== root.id
        ? result.nodes.find(node => node.id === containerId)
        : undefined;
      const edgeX = origin?.x ?? x, edgeY = origin?.y ?? y;
      result.edges.push({
        id: edge.id,
        points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(p => ({ x: edgeX + p.x, y: edgeY + p.y })),
        label: label ? { x: edgeX + label.x!, y: edgeY + label.y!, width: label.width!, height: label.height!, lines: diagramLines(label.text!, 12) } : undefined,
      });
    }
  }
  collect(root, 0, 0);
  // The layout engine routes to bounding rectangles. Move terminals inward to
  // the visible outline of diamonds and ellipses without changing route lanes.
  for (const route of result.edges) {
    const edge = page.edges.find(edge => edge.id === route.id)!;
    for (const [id, point] of [[edge.source, route.points[0]], [edge.target, route.points.at(-1)!]] as const) {
      const node = page.nodes.find(node => node.id === id)!;
      if (node.shape !== "diamond" && node.shape !== "circle") continue;
      const box = result.nodes.find(box => box.id === id)!;
      const rx = box.width / 2, ry = box.height / 2;
      const cx = box.x + rx, cy = box.y + ry;
      const inset = (offset: number) => node.shape === "diamond"
        ? Math.max(0, 1 - Math.abs(offset))
        : Math.sqrt(Math.max(0, 1 - offset * offset));
      if (Math.abs(point.y - box.y) < 0.01 || Math.abs(point.y - box.y - box.height) < 0.01)
        point.y = cy + (point.y < cy ? -1 : 1) * ry * inset((point.x - cx) / rx);
      else if (Math.abs(point.x - box.x) < 0.01 || Math.abs(point.x - box.x - box.width) < 0.01)
        point.x = cx + (point.x < cx ? -1 : 1) * rx * inset((point.y - cy) / ry);
    }
  }
  for (const box of result.nodes)
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) throw new Error("图示布局计算失败");
  for (const [index, a] of result.nodes.entries()) {
    for (const b of result.nodes.slice(index + 1)) {
      const first = page.nodes.find(n => n.id === a.id)!;
      const second = page.nodes.find(n => n.id === b.id)!;
      if (first.groupId === b.id || second.groupId === a.id) continue;
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)
        throw new Error("图示布局出现重叠，请调整分组后重试");
    }
  }
  return result;
}
