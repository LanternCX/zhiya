export type KnowledgeSource = {
  version: string;
  blockId: string;
  documentId: string;
  title: string;
  modality: string;
  location: { page?: number; start_seconds?: number; end_seconds?: number };
  text: string;
  warnings: string[];
  citation: string;
  score: number;
  hasAsset: boolean;
  visual?: { transcription: string; description: string; warnings: string[] };
};
export type KnowledgeSearch = {
  id: string;
  query: string;
  status: "running" | "complete" | "error";
  sources: KnowledgeSource[];
  error?: string;
};
