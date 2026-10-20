import MarkdownIt from "markdown-it";
import type { Deliverable, DeliverableBlock } from "../../domain/deliverable";
import type { ExportImage } from "./export";
import styles from "./reader.css?inline";
import { diagramSVG } from "../course/diagram-svg";

const markdown = new MarkdownIt({ html: false, breaks: true });
// Pictures must come from authorized image IDs, never arbitrary remote URLs.
markdown.renderer.rules.image = (tokens, index) =>
  escapeHTML(tokens[index].content);
markdown.renderer.rules.link_open = (
  tokens,
  index,
  options,
  _env,
  renderer,
) => {
  tokens[index].attrSet("rel", "noreferrer noopener");
  tokens[index].attrSet("target", "_blank");
  return renderer.renderToken(tokens, index, options);
};

export function escapeHTML(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

export async function renderBlock(block: DeliverableBlock): Promise<string> {
  return `${block.diagram ? await diagram(block.diagram) : ""}${markdown.render(block.markdown)}`;
}

async function diagram(value: NonNullable<DeliverableBlock["diagram"]>): Promise<string> {
  const labels = new Map(value.nodes.map((node) => [node.id, node.label]));
  // The textual legend preserves long labels, edge direction and grouping at every size.
  const legend = [
    ...value.nodes.map(
      (node) =>
        `${node.label}${node.groupId ? `（所属：${labels.get(node.groupId) ?? node.groupId}）` : ""}`,
    ),
    ...value.edges.map(
      (edge) =>
        `${labels.get(edge.source) ?? edge.source} ${edge.arrow === false ? "—" : "→"} ${labels.get(edge.target) ?? edge.target}${edge.label ? `：${edge.label}` : ""}`,
    ),
  ];
  return `<figure class="reader-diagram">${await diagramSVG(value)}<figcaption><ul>${legend.map((label) => `<li>${escapeHTML(label)}</li>`).join("")}</ul></figcaption></figure>`;
}

export async function exportHTML(
  item: Deliverable,
  readImage: (id: string) => Promise<ExportImage>,
): Promise<Blob> {
  const pictures = new Map<string, ExportImage>();
  for (const id of new Set(item.blocks.flatMap((block) => block.imageIds))) {
    const image = await readImage(id);
    if (
      !/^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(
        image.data,
      )
    )
      throw new Error("图片无法嵌入 HTML 文件");
    pictures.set(id, image);
  }
  const sections = (await Promise.all(item.blocks
    .map(
      async (block, index) =>
        `<section class="reader-section" id="page-${index + 1}"><p class="reader-kicker">${index + 1} / ${item.blocks.length}</p><h2>${escapeHTML(block.title)}</h2>${await renderBlock(block)}${block.imageIds.map((id) => {
          const image = pictures.get(id)!;
          return `<img src="${image.data}" width="${image.width}" height="${image.height}" alt="${escapeHTML(block.title)}"/>`;
        }).join("")}</section>`,
    )))
    .join("");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHTML(item.title)}</title><style>${styles}</style></head><body class="reader-page"><header class="reader-header"><span class="reader-brand">知芽 · ${item.kind === "presentation" ? "演示文稿" : "文档"}</span><h1>${escapeHTML(item.title)}</h1><p>导出快照 · ${escapeHTML(item.updatedAt.slice(0, 10))}</p></header><main class="reader-content">${sections}</main>${
    item.kind === "presentation" && item.blocks.length
      ? `<nav class="reader-controls" aria-label="翻页"><button id="previous">上一页</button><output id="position" aria-live="polite"></output><button id="next">下一页</button><button id="all">阅读全部</button></nav><script>
const pages = Array.from(document.querySelectorAll('.reader-section'));
const previous = document.getElementById('previous'), next = document.getElementById('next'), all = document.getElementById('all'), position = document.getElementById('position');
let current = 0, reading = false;
function render() { pages.forEach((page,index) => page.hidden = !reading && index !== current); previous.disabled = reading || current === 0; next.disabled = reading || current === pages.length - 1; position.textContent = reading ? '共 ' + pages.length + ' 页' : (current + 1) + ' / ' + pages.length; all.textContent = reading ? '分页演示' : '阅读全部'; }
previous.addEventListener('click', () => { current = Math.max(0,current - 1); render(); });
next.addEventListener('click', () => { current = Math.min(pages.length - 1,current + 1); render(); });
all.addEventListener('click', () => { reading = !reading; render(); });
document.addEventListener('keydown', event => { if (event.key === 'ArrowRight' && !next.disabled) next.click(); if (event.key === 'ArrowLeft' && !previous.disabled) previous.click(); });
render();
</script>`
      : ""
  }</body></html>`;
  return new Blob([html], { type: "text/html;charset=utf-8" });
}
