export type ObjectRequest = {
  url: string;
  headers?: Record<string, string>;
};

export class ObjectStorageError extends Error {
  constructor(
    public kind: "network" | "response",
    public status?: number,
  ) {
    super("Object storage request failed");
  }
}

export async function uploadObject(
  request: ObjectRequest,
  content: Blob,
): Promise<void> {
  await objectFetch(request, { method: "PUT", body: content });
}

export async function readObjectText(request: ObjectRequest): Promise<string> {
  const response = await objectFetch(request);
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

async function objectFetch(request: ObjectRequest, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(request.url, {
      ...init,
      headers: request.headers,
      credentials: "omit",
      signal: AbortSignal.timeout(
        __ZHIYA_CLIENT_CONFIG__.requestTimeoutMilliseconds,
      ),
    });
  } catch {
    throw new ObjectStorageError("network");
  }
  if (!response.ok) {
    throw new ObjectStorageError("response", response.status);
  }
  return response;
}
