import { api } from "../api";
import { readObjectBlob } from "./object-storage";

export type IllustrationGeneration = {
  id: string;
  pageId: string;
  title: string;
  alt: string;
  status: "running" | "complete" | "failed" | "cancelled";
  assetId?: string;
  error?: string;
};

export async function createIllustration(
  courseId: string,
  conversationId: string,
  request: { pageId: string; title: string; description: string; alt: string },
) {
  return (
    await api<{ generation: IllustrationGeneration }>(
      `/courses/${courseId}/image-generations`,
      "POST",
      { conversationId, ...request },
    )
  ).generation;
}

export async function getIllustration(courseId: string, generationId: string) {
  return (
    await api<{ generation: IllustrationGeneration }>(
      `/courses/${courseId}/image-generations/${generationId}`,
    )
  ).generation;
}

export async function cancelIllustration(
  courseId: string,
  generationId: string,
) {
  await api(`/courses/${courseId}/image-generations/${generationId}`, "DELETE");
}

export async function readIllustration(courseId: string, assetId: string) {
  const request = await api<{ url: string; headers?: Record<string, string> }>(
    `/courses/${courseId}/illustrations/${assetId}/download`,
  );
  return readObjectBlob(request);
}
