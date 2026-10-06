/** Knowledge citations are chat UI references, not portable teaching content. */
export function assertArtifactContent(text: string) {
  if (/#knowledge\//i.test(text)) {
    throw new Error("Knowledge references belong in chat, not teaching artifacts. Remove internal citation links, IDs and source review labels; keep the supported teaching content.");
  }
}
