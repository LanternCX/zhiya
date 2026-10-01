import type {
  ModelRetryListener,
  ModelRetryStatus,
} from "../../../../packages/learning/src/domain/learning";

export function observeModelRetries(
  response: Response,
  onRetry?: ModelRetryListener,
): Response {
  if (!onRetry || !response.body) return response;
  const decoder = new TextDecoder();
  let buffer = "";
  let retrying = false;
  const inspect = (text: string) => {
    buffer += text;
    for (
      let newline = buffer.indexOf("\n");
      newline >= 0;
      newline = buffer.indexOf("\n")
    ) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.startsWith(": zhiya-retry ")) {
        try {
          const status = JSON.parse(line.slice(14)) as ModelRetryStatus;
          if (
            Number.isInteger(status.attempt) &&
            Number.isInteger(status.maxRetries) &&
            status.attempt > 0 &&
            status.maxRetries >= status.attempt
          ) {
            retrying = true;
            onRetry(status);
          }
        } catch {
          // Unknown SSE comments remain invisible protocol metadata.
        }
      } else if (retrying && line.startsWith("data:")) {
        retrying = false;
        onRetry(null);
      }
    }
  };
  const observed = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        inspect(decoder.decode(chunk, { stream: true }));
        controller.enqueue(chunk);
      },
      flush() {
        inspect(decoder.decode());
        if (retrying) onRetry(null);
      },
    }),
  );
  return new Response(observed, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
