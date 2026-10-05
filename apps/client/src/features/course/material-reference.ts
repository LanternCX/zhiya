export type MaterialReference = {
  materialId: string;
  revision: number;
  ranges: Array<{ startLine: number; endLine: number }>;
};

export function parseMaterialReference(href: string): MaterialReference | null {
  const match = /^#material\/([\w-]+)\/([1-9]\d*)\/([\d,-]+)$/.exec(href);
  if (!match) return null;
  const revision = Number(match[2]);
  const parts = match[3].split(",");
  if (!Number.isSafeInteger(revision) || parts.length > 10) return null;
  const ranges: MaterialReference["ranges"] = [];
  for (const part of parts) {
    const range = /^([1-9]\d*)(?:-([1-9]\d*))?$/.exec(part);
    if (!range) return null;
    const startLine = Number(range[1]);
    const endLine = Number(range[2] ?? range[1]);
    if (
      !Number.isSafeInteger(startLine) ||
      !Number.isSafeInteger(endLine) ||
      endLine < startLine ||
      endLine - startLine >= 200
    )
      return null;
    ranges.push({ startLine, endLine });
  }
  return { materialId: match[1], revision, ranges };
}
