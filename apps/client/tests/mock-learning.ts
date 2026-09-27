import type { BrowserContext, Page, WebSocketRoute } from "@playwright/test";

type State = Record<string, unknown> & {
  messages: unknown[];
  messageSequence: number;
  revision: number;
};

type ActionResult = { data?: unknown; state?: State };
type Router =
  | Pick<Page, "route" | "routeWebSocket">
  | Pick<BrowserContext, "route" | "routeWebSocket">;

export async function mockLearning(
  router: Router,
  current: () => State,
  action: (
    value: Record<string, unknown>,
  ) => ActionResult | Promise<ActionResult> = () => ({
    state: current(),
  }),
) {
  let socket: WebSocketRoute | undefined;
  await router.route("**/api/socket-ticket", (route) =>
    route.fulfill({ json: { ticket: "test-ticket" } }),
  );
  await router.routeWebSocket("**/api/learning/socket*", (ws) => {
    socket = ws;
    ws.send(JSON.stringify({ type: "snapshot", state: current() }));
    ws.onMessage(async (raw) => {
      const request = JSON.parse(String(raw));
      try {
        const result = await action(request.action);
        ws.send(
          JSON.stringify({
            type: "response",
            requestId: request.requestId,
            data: result.data,
            state: result.state,
          }),
        );
      } catch (error) {
        ws.send(
          JSON.stringify({
            type: "error",
            requestId: request.requestId,
            status: 503,
            error: error instanceof Error ? error.message : "操作失败",
          }),
        );
      }
    });
  });
  return {
    sync(state: State) {
      socket?.send(JSON.stringify({ type: "sync", state }));
    },
  };
}
