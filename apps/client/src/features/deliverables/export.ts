import PptxGenJS from "pptxgenjs";
import MarkdownIt from "markdown-it";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
} from "docx";
import type { Deliverable } from "../../domain/deliverable";
import { layoutDiagram } from "../course/diagram-layout";

export type ExportImage = { data: string; width: number; height: number };
type Content =
  | { kind: "text" | "code" | "heading"; text: string }
  | { kind: "table"; rows: string[][] };
const markdown = new MarkdownIt({ html: false });

function content(source: string): Content[] {
  const tokens = markdown.parse(source, {});
  const result: Content[] = [];
  let table: string[][] | null = null;
  let row: string[] = [];
  let heading = false;
  const lists: Array<{ ordered: boolean; next: number; marker: string }> = [];
  for (const token of tokens) {
    if (token.type === "table_open") table = [];
    else if (token.type === "tr_open") row = [];
    else if (token.type === "tr_close") table?.push(row);
    else if (token.type === "table_close") {
      result.push({ kind: "table", rows: table ?? [] });
      table = null;
    } else if (token.type === "heading_open") heading = true;
    else if (token.type === "heading_close") heading = false;
    else if (
      token.type === "bullet_list_open" ||
      token.type === "ordered_list_open"
    )
      lists.push({
        ordered: token.type === "ordered_list_open",
        next: Number(token.attrGet("start") ?? 1),
        marker: "",
      });
    else if (
      token.type === "bullet_list_close" ||
      token.type === "ordered_list_close"
    )
      lists.pop();
    else if (token.type === "list_item_open") {
      const list = lists.at(-1);
      if (list) list.marker = list.ordered ? `${list.next++}. ` : "• ";
    } else if (token.type === "fence" || token.type === "code_block")
      result.push({ kind: "code", text: token.content.trimEnd() });
    else if (token.type === "inline") {
      const text = (token.children ?? [])
        .map((t) =>
          t.type === "softbreak" || t.type === "hardbreak"
            ? "\n"
            : ["text", "code_inline"].includes(t.type)
              ? t.content
              : "",
        )
        .join("");
      if (table) row.push(text);
      else
        result.push({
          kind: heading ? "heading" : "text",
          text: (lists.at(-1)?.marker ?? "") + text,
        });
    }
  }
  return result;
}

// Conservative CJK-aware wrapping keeps dense content on continuation slides.
function lines(text: string, limit: number): string[] {
  return text.split("\n").flatMap((line) => {
    const result: string[] = [];
    let current = "";
    let width = 0;
    for (const char of line) {
      const size = char.charCodeAt(0) > 255 ? 2 : 1;
      if (width + size > limit) {
        result.push(current);
        current = "";
        width = 0;
      }
      current += char;
      width += size;
    }
    result.push(current);
    return result;
  });
}

export async function exportDeliverable(
  item: Deliverable,
  readImage: (id: string) => Promise<ExportImage>,
): Promise<Blob> {
  // Resolve all pictures before creating a file: failures must not silently omit content.
  const pictures = new Map<string, ExportImage>();
  for (const id of new Set(item.blocks.flatMap((b) => b.imageIds)))
    pictures.set(id, await readImage(id));
  if (item.kind === "document") {
    const children: Array<Paragraph | Table> = [
      new Paragraph({
        text: item.title,
        heading: HeadingLevel.TITLE,
        spacing: { after: 320 },
      }),
    ];
    for (const block of item.blocks) {
      children.push(
        new Paragraph({
          text: block.title,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 320, after: 180 },
          keepNext: true,
        }),
      );
      for (const part of content(block.markdown)) {
        if (part.kind === "table")
          children.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: part.rows.map(
                (row, i) =>
                  new TableRow({
                    tableHeader: i === 0,
                    children: row.map(
                      (text) =>
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [new TextRun({ text, bold: i === 0 })],
                            }),
                          ],
                        }),
                    ),
                  }),
              ),
            }),
          );
        else
          children.push(
            new Paragraph({
              ...(part.kind === "heading"
                ? { heading: HeadingLevel.HEADING_2 }
                : {}),
              spacing: {
                before: part.kind === "heading" ? 200 : 0,
                after: 160,
              },
              children: part.text
                .split("\n")
                .map(
                  (text, i) =>
                    new TextRun({
                      text,
                      ...(i ? { break: 1 } : {}),
                      ...(part.kind === "code"
                        ? { font: "Consolas", size: 20 }
                        : {}),
                    }),
                ),
            }),
          );
      }
      for (const id of block.imageIds) {
        const picture = pictures.get(id)!;
        const scale = Math.min(540 / picture.width, 640 / picture.height, 1);
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                type: "png",
                data: picture.data.split(",")[1],
                transformation: {
                  width: Math.max(1, Math.round(picture.width * scale)),
                  height: Math.max(1, Math.round(picture.height * scale)),
                },
                altText: {
                  title: block.title,
                  description: block.title,
                  name: id,
                },
              }),
            ],
          }),
        );
      }
    }
    return Packer.toBlob(
      new Document({
        title: item.title,
        creator: "知芽",
        styles: {
          default: {
            document: {
              run: { font: "Microsoft YaHei", size: 24 },
              paragraph: { spacing: { line: 360 } },
            },
          },
        },
        sections: [{ children }],
      }),
    );
  }
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "知芽";
  pptx.title = item.title;
  pptx.subject = `修订 ${item.revision}`;
  pptx.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
  };
  for (const block of item.blocks) {
    let page = 0;
    let y = 1.25;
    const newPage = () => {
      const slide = pptx.addSlide();
      page++;
      const title = lines(block.title + (page > 1 ? " · 续" : ""), 60);
      const titleHeight = title.length * 0.5;
      y = Math.max(1.25, 0.6 + titleHeight);
      slide.background = { color: "FAFAF7" };
      slide.addText(title.join("\n"), {
        x: 0.65,
        y: 0.4,
        w: 12,
        h: titleHeight,
        fontSize: 24,
        bold: true,
        color: "243C30",
        margin: 0,
        breakLine: false,
      });
      slide.addText(item.title, {
        x: 0.65,
        y: 7.06,
        w: 12,
        h: 0.18,
        fontSize: 9,
        color: "777777",
        margin: 0,
        fit: "shrink",
      });
      return slide;
    };
    let slide = newPage();
    if (block.diagram) {
      const layout = await layoutDiagram(block.diagram);
      const nodes = [...block.diagram.nodes].sort((a, b) => Number(b.shape === "group") - Number(a.shape === "group"));
      const highlighted = new Set(block.diagram.highlightedIds);
      const flowing = new Set(block.diagram.flowingIds);
      if (nodes.length) {
        const batch = nodes;
        const scale = Math.min(12 / layout.width, (6.6 - y) / layout.height);
        const positions = new Map(layout.nodes.map(node => [node.id, {
          x: 0.65 + node.x * scale, y: y + node.y * scale,
          w: node.width * scale, h: node.height * scale,
        }]));
        // Containers must be behind both connections and their children.
        for (const node of batch.filter(node => node.shape === "group")) {
          const box = positions.get(node.id)!;
          slide.addShape(pptx.ShapeType.rect, { ...box, fill: { color: "F1EFE6" }, line: { color: "6F8B76" } });
          const lines = layout.nodes.find(n => n.id === node.id)!.lines;
          slide.addText(lines.join("\n"), { ...box, h: (lines.length * 24 + 16) * scale, fontSize: 16 * scale * 72, align: "center", margin: 0 });
        }
        for (const edge of block.diagram.edges) {
          const start = positions.get(edge.source), end = positions.get(edge.target);
          if (!start || !end) continue;
          const route = layout.edges.find(e => e.id === edge.id)!;
          for (let i = 1; i < route.points.length; i++) {
          const x1 = 0.65 + route.points[i - 1].x * scale, y1 = y + route.points[i - 1].y * scale;
          const x2 = 0.65 + route.points[i].x * scale, y2 = y + route.points[i].y * scale;
          const emphasized = highlighted.has(edge.id) || flowing.has(edge.id);
          slide.addShape(pptx.ShapeType.line, {
            x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
            flipH: x2 < x1, flipV: y2 < y1,
            line: {
              color: emphasized ? "2F7D50" : "6F8B76",
              width: emphasized ? 3 : 1.5,
              ...(flowing.has(edge.id) ? { dashType: "dash" as const } : {}),
              ...(edge.arrow !== false && i === route.points.length - 1 ? { endArrowType: "triangle" as const } : {}),
            },
          });
          }
          if (route.label) slide.addText(route.label.lines.join("\n"), { x: 0.65 + route.label.x * scale, y: y + route.label.y * scale, w: route.label.width * scale, h: route.label.height * scale, fontSize: 14 * scale * 72, align: "center", color: "243C30", margin: 0 });
        }
        for (const node of batch) {
          if (node.shape === "group") continue;
          const box = positions.get(node.id)!;
          if (node.shape !== "text") slide.addShape(node.shape === "circle" ? pptx.ShapeType.ellipse : node.shape === "diamond" ? pptx.ShapeType.diamond : pptx.ShapeType.rect, { ...box, fill: { color: "E7EEE5" }, line: { color: highlighted.has(node.id) ? "2F7D50" : "6F8B76", width: highlighted.has(node.id) ? 3 : 1 } });
          const label = layout.nodes.find(n => n.id === node.id)!.lines.join("\n");
          slide.addText(label, { ...box, fontSize: 16 * scale * 72, bold: highlighted.has(node.id), color: "243C30", align: "center", valign: "middle", margin: 0, fit: "shrink" });
        }
        y += layout.height * scale;
      }
    }
    for (const part of content(block.diagram ? "" : block.markdown)) {
      if (part.kind === "table") {
        const columns = Math.max(...part.rows.map((r) => r.length), 1);
        // Rows are split into readable fragments instead of shrinking all table text.
        for (let rowIndex = 0; rowIndex < part.rows.length; rowIndex++) {
          const cells = part.rows[rowIndex].map((t) =>
            lines(t, Math.max(8, Math.floor(95 / columns))),
          );
          const count = Math.max(...cells.map((c) => c.length), 1);
          for (let offset = 0; offset < count; offset += 8) {
            const height = Math.min(8, count - offset) * 0.25 + 0.2;
            if (y + height > 6.75) slide = newPage();
            slide.addTable(
              [
                cells.map((c) => ({
                  text: c.slice(offset, offset + 8).join("\n"),
                })),
              ],
              {
                x: 0.65,
                y,
                w: 12,
                h: height,
                rowH: height,
                fontSize: 14,
                margin: 0.05,
                border: { type: "solid", pt: 0.5, color: "D9DED7" },
                fill: { color: rowIndex === 0 ? "E7EEE5" : "FAFAF7" },
                bold: rowIndex === 0,
                color: "243C30",
                valign: "top",
              },
            );
            y += height;
          }
        }
        y += 0.16;
      } else {
        const wrapped = lines(part.text, part.kind === "code" ? 86 : 90);
        while (wrapped.length) {
          if (y + 0.4 > 6.75) slide = newPage();
          const take = Math.max(1, Math.floor((6.75 - y) / 0.37));
          const chunk = wrapped.splice(0, take);
          const height = chunk.length * 0.37;
          slide.addText(chunk.join("\n"), {
            x: 0.65,
            y,
            w: 12,
            h: height,
            margin: 0,
            fontSize: part.kind === "code" ? 16 : 18,
            bold: part.kind === "heading",
            fontFace: part.kind === "code" ? "Consolas" : "Microsoft YaHei",
            color: "24332C",
            valign: "top",
            breakLine: false,
            lineSpacingMultiple: 1.1,
          });
          y += height + 0.2;
        }
      }
    }
    for (const id of block.imageIds) {
      const picture = pictures.get(id)!;
      if (y > 2.5) slide = newPage();
      const available = 6.7 - y;
      const scale = Math.min(12 / picture.width, available / picture.height);
      const w = picture.width * scale;
      const h = picture.height * scale;
      slide.addImage({
        data: picture.data,
        x: 0.65 + (12 - w) / 2,
        y,
        w,
        h,
        altText: block.title,
      });
      y += h + 0.2;
    }
  }
  return (await pptx.write({ outputType: "blob" })) as Blob;
}
