import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { activeUser, sessionRevision } from "./identity";
import type { ModelRetryListener, ModelRetryStatus } from "../domain/learning";

export async function modelRequest(
  runId: string,
  payload: object,
  signal?: AbortSignal,
  onRetry?: ModelRetryListener,
): Promise<Response> {
  return streamingModelRequest(
    "/api/learning/model",
    JSON.stringify({ runId, payload }),
    signal,
    onRetry,
  );
}

export async function courseModelRequest(
  agent: "teacher" | "slides" | "animation" | "outline-classifier",
  payload: object,
  signal?: AbortSignal,
  onRetry?: ModelRetryListener,
): Promise<Response> {
  return streamingModelRequest(
    "/api/learning/course/model",
    JSON.stringify({ agent, payload }),
    signal,
    onRetry,
  );
}

async function streamingModelRequest(
  path: string,
  body: string,
  signal?: AbortSignal,
  onRetry?: ModelRetryListener,
): Promise<Response> {
  const expectedUser = activeUser;
  const revision = sessionRevision;
  if (!isTauri())
    return observeModelRetries(
      await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Zhiya-Request": "1",
          "X-Zhiya-User": expectedUser,
        },
        body,
        signal,
      }),
      onRetry,
    );
  type Part = { status?: number; bytes?: number[]; done?: boolean };
  return new Promise<Response>((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    let ended = false;
    const fail = (error: unknown) => {
      if (ended) return;
      ended = true;
      controller.error(error);
      reject(error);
    };
    const channel = new Channel<Part>();
    channel.onmessage = (part) => {
      if (ended) return;
      if (revision !== sessionRevision || signal?.aborted) {
        fail(new Error("会话已中断"));
        return;
      }
      if (part.status)
        resolve(
          observeModelRetries(
            new Response(stream, {
              status: part.status,
              headers: { "Content-Type": "text/event-stream" },
            }),
            onRetry,
          ),
        );
      if (part.bytes) controller.enqueue(new Uint8Array(part.bytes));
      if (part.done) {
        ended = true;
        controller.close();
      }
    };
    signal?.addEventListener("abort", () => fail(new Error("会话已中断")), {
      once: true,
    });
    void invoke("model_request", {
      body,
      expectedUser,
      course: path.endsWith("/course/model"),
      onEvent: channel,
    }).catch(fail);
  });
}

function observeModelRetries(
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
