import { invoke, isTauri } from "@tauri-apps/api/core";
import { activeUser, sessionRevision } from "./transport/identity";

export type User = {
  id: string;
  email: string;
  nickname: string;
  avatar: string;
};
export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId = "",
    public retryAfterMilliseconds?: number,
  ) {
    super(
      status >= 500 && requestId
        ? `${message}（错误编号：${requestId}）`
        : message,
    );
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

export function connectionRetryDelay(error?: unknown): number {
  return error instanceof APIError && error.status === 429
    ? Math.max(1000, error.retryAfterMilliseconds ?? 60000)
    : 1000;
}

/** Only retry operations explicitly safe to repeat, such as opening a view. */
export async function retryRateLimited<T>(
  request: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  for (;;) {
    signal.throwIfAborted();
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof APIError) || error.status !== 429) throw error;
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(
          () => {
            signal.removeEventListener("abort", abort);
            resolve();
          },
          Math.min(connectionRetryDelay(error), 2147483647),
        );
        signal.addEventListener("abort", abort, { once: true });
      });
    }
  }
}

function reportAPIFailure(
  path: string,
  method: string,
  status: number,
  requestId: string,
  kind: "transport" | "response" | "server",
) {
  console.error("[zhiya] API request failed", {
    path,
    method,
    status,
    requestId: requestId || undefined,
    kind,
  });
}

export async function api<T = { ok: boolean }>(
  path: string,
  method = "GET",
  body?: object,
): Promise<T> {
  const expectedUser = activeUser;
  const expectedRevision = sessionRevision;
  let status: number;
  let text: string;
  let requestId = "";
  let retryAfterMilliseconds: number | undefined;
  try {
    if (isTauri()) {
      const response = await invoke<{
        status: number;
        body: string;
        requestId?: string;
        retryAfter?: string;
      }>("account_request", {
        path,
        method,
        body: body ? JSON.stringify(body) : null,
        expectedUser,
      });
      status = response.status;
      text = response.body;
      requestId = response.requestId ?? "";
      retryAfterMilliseconds = parseRetryAfter(response.retryAfter ?? null);
    } else {
      const response = await fetch(`/api${path}`, {
        method,
        credentials: "same-origin",
        signal: AbortSignal.timeout(
          method === "POST" && /^\/courses\/[^/]+\/deliverables\/import$/.test(path)
            ? 180000 : __ZHIYA_CLIENT_CONFIG__.requestTimeoutMilliseconds,
        ),
        headers: {
          "Content-Type": "application/json",
          "X-Zhiya-Request": "1",
          "X-Zhiya-User": expectedUser,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      status = response.status;
      text = await response.text();
      requestId = response.headers.get("X-Request-ID") ?? "";
      retryAfterMilliseconds = parseRetryAfter(
        response.headers.get("Retry-After"),
      );
    }
  } catch (err) {
    reportAPIFailure(path, method, 0, "", "transport");
    if (typeof err === "string" && /secure storage/i.test(err))
      throw new APIError(0, "无法访问系统安全存储，请解锁后重试");
    if (typeof err === "string" && /application configuration/i.test(err))
      throw new APIError(0, "应用尚未配置服务地址");
    throw new APIError(0, "暂时无法连接，请检查网络后重试");
  }
  let data;
  if (expectedRevision !== sessionRevision)
    throw new APIError(409, "账号已切换，请重新操作");
  try {
    data = JSON.parse(text);
  } catch {
    reportAPIFailure(path, method, status, requestId, "response");
    throw new APIError(
      status,
      "服务响应异常，请稍后重试",
      requestId,
      retryAfterMilliseconds,
    );
  }
  if (status < 200 || status >= 300) {
    if (status >= 500)
      reportAPIFailure(path, method, status, requestId, "server");
    throw new APIError(
      status,
      data.error ?? "操作失败，请重试",
      requestId,
      retryAfterMilliseconds,
    );
  }
  return data as T;
}
