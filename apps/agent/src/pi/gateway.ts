import type { ModelRetryListener } from "../domain/learning";

/** Model payloads and streams are transported by the host application. */
export interface ModelGateway {
  onboarding(
    runId: string,
    payload: object,
    signal?: AbortSignal,
    onRetry?: ModelRetryListener,
  ): Promise<Response>;
  course(
    agent: "teacher" | "slides" | "animation" | "outline-classifier",
    payload: object,
    signal?: AbortSignal,
    onRetry?: ModelRetryListener,
  ): Promise<Response>;
}
