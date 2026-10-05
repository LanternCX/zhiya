export type DeliverableBlock = {
  id: string;
  title: string;
  markdown: string;
  imageIds: string[];
  source?: {
    conversationId?: string;
    pageId?: string;
    deliverableId?: string;
    blockId?: string;
  };
  diagram?: Pick<import("./learning").AnimationPage, "nodes" | "edges" | "layout"> & {
    highlightedIds?: string[];
    flowingIds?: string[];
  };
};

export type Deliverable = {
  id: string;
  kind: "presentation" | "document";
  title: string;
  revision: number;
  blocks: DeliverableBlock[];
  updatedAt: string;
  importNotes?: string[];
  source?: "classroom" | "course-document";
};

export type DeliverableSelection = {
  id: string;
  blockId?: string;
};
