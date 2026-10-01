import { observeModelRetries } from "./model";
import type { ModelRetryListener } from "../../../packages/learning/src/domain/learning";

export class ToolAPIError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ToolAPI {
  constructor(
    private origin: string,
    private secret: string,
    readonly id: string,
    readonly grant: string,
  ) {}
  async request(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ) {
    const response = await fetch(new URL(path, this.origin), {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${this.secret}`,
        "Content-Type": "application/json",
        "X-Zhiya-Agent-Session": this.id,
        "X-Zhiya-Execution": this.grant,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok && !path.endsWith("/model")) {
      const error = (await response
        .json()
        .catch(() => ({ error: "内部服务不可用" }))) as { error?: string };
      throw new ToolAPIError(response.status, error.error ?? "内部服务不可用");
    }
    return response;
  }
  async json<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    return (await this.request(path, method, body)).json() as Promise<T>;
  }
  object(url: string, init?: RequestInit) {
    return fetch(url, init);
  }
  async model(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    onRetry?: ModelRetryListener,
  ) {
    return observeModelRetries(
      await this.request(path, "POST", body, signal),
      onRetry,
    );
  }
}
