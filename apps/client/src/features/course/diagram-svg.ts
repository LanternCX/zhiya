import type { AnimationPage } from "../../domain/learning";
import { layoutDiagram } from "./diagram-layout";

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export async function diagramSVG(page: Pick<AnimationPage, "nodes" | "edges" | "layout"> & { highlightedIds?: string[]; flowingIds?: string[] }) {
  const layout = await layoutDiagram(page);
  const emphasized = new Set([...(page.highlightedIds ?? []), ...(page.flowingIds ?? [])]);
  const text = (lines: string[], x: number, y: number) => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="#243C30" font-size="16" font-family="sans-serif">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? 24 : 0}">${escape(line)}</tspan>`).join("")}</text>`;
  const nodes = layout.nodes.map(box => {
    const node = page.nodes.find(n => n.id === box.id)!;
    const { x, y, width: w, height: h } = box;
    const shape = node.shape === "text" ? "" : node.shape === "circle"
      ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"/>`
      : node.shape === "diamond" ? `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}"/>`
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>`;
    return { group: node.shape === "group", svg: `<g fill="${node.shape === "group" ? "#F1EFE6" : "#E7EEE5"}" stroke="${emphasized.has(node.id) ? "#2F7D50" : "#6F8B76"}" stroke-width="${emphasized.has(node.id) ? 3 : 1.5}">${shape}</g>${text(box.lines, x + w / 2, node.shape === "group" ? y + 24 : y + h / 2 - (box.lines.length - 1) * 12)}` };
  });
  const edges = layout.edges.map(route => {
    const edge = page.edges.find(e => e.id === route.id)!;
    const end = route.points.at(-1)!, previous = route.points.at(-2)!;
    const angle = Math.atan2(end.y - previous.y, end.x - previous.x) * 180 / Math.PI;
    const color = emphasized.has(edge.id) ? "#2F7D50" : "#6F8B76";
    return `<path d="${route.points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2"${page.flowingIds?.includes(edge.id) ? ' stroke-dasharray="6 4"' : ""}/>${edge.arrow === false ? "" : `<path d="M0,0 L-10,-5 L-10,5 Z" transform="translate(${end.x} ${end.y}) rotate(${angle})" fill="${color}"/>`}${route.label ? `<rect x="${route.label.x}" y="${route.label.y}" width="${route.label.width}" height="${route.label.height}" fill="#FFFFFF"/>${text(route.label.lines, route.label.x + route.label.width / 2, route.label.y + 18)}` : ""}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="教学图示" viewBox="0 0 ${layout.width} ${layout.height}">${nodes.filter(n => n.group).map(n => n.svg).join("")}${edges}${nodes.filter(n => !n.group).map(n => n.svg).join("")}</svg>`;
}
