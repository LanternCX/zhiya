import { expect, test } from "@playwright/test";

for (const kind of [
  "initialization",
  "session",
  "statuses",
  "profile",
] as const) {
  for (const scenario of ["seconds", "date", "missing", "leave"] as const) {
    test(`${kind} respects rate limiting (${scenario})`, async ({ page }) => {
      await page.clock.install({ time: new Date("2026-10-01T00:00:00Z") });
      await page.route("**/rate-limit-harness", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<html><script type="module" src="/@vite/client"></script></html>',
        }),
      );
      let attempts = 0;
      const limited =
        kind === "initialization" ? "agent/sessions" : "socket-ticket";
      await page.route(`**/api/${limited}`, (route) => {
        attempts++;
        return attempts === 1
          ? route.fulfill({
              status: 429,
              headers:
                scenario === "missing"
                  ? {}
                  : {
                      "Retry-After":
                        scenario === "date"
                          ? "Thu, 01 Oct 2026 00:00:05 GMT"
                          : "5",
                    },
              json: { error: "操作太频繁" },
            })
          : route.fulfill({
              json:
                limited === "socket-ticket"
                  ? { ticket: "ticket" }
                  : { id: "session", revision: 1, state: { text: "initial" } },
            });
      });
      if (kind !== "initialization")
        await page.route("**/api/agent/sessions", (route) =>
          route.fulfill({
            json: { id: "session", revision: 1, state: { text: "initial" } },
          }),
        );
      else
        await page.route("**/api/socket-ticket", (route) =>
          route.fulfill({ json: { ticket: "ticket" } }),
        );
      await page.routeWebSocket("**/api/**/socket*", (socket) => {
        socket.send(
          JSON.stringify(
            kind === "statuses"
              ? { sessions: [{ id: "recovered" }] }
              : kind === "profile"
                ? {
                    type: "snapshot",
                    state: {
                      revision: 1,
                      messages: [],
                      messageSequence: 0,
                      memory: "recovered",
                    },
                  }
                : { id: "session", revision: 2, state: { text: "recovered" } },
          ),
        );
      });
      await page.goto("/rate-limit-harness");
      await page.evaluate(async (kind) => {
        const root = window as any;
        root.received = [];
        const agentPath = "/src/transport/agent.ts";
        const { AgentConnection, subscribeAgentStatuses } = await import(
          agentPath
        );
        if (kind === "statuses") {
          root.stop = subscribeAgentStatuses((sessions: any[]) =>
            root.received.push(sessions[0].id),
          );
        } else if (kind === "profile") {
          const channelPath = "/src/features/profile/channel.ts";
          const { ConversationChannel } = await import(channelPath);
          const channel = new ConversationChannel();
          channel.subscribe((state: any) => root.received.push(state.memory));
          void channel.open().catch(() => {});
          root.stop = () => channel.close();
        } else {
          const connection = new AgentConnection(
            { kind: "profile" },
            (state: any) => root.received.push(state.text),
            () => {},
          );
          root.stop = () => connection.close();
        }
      }, kind);
      await expect.poll(() => attempts).toBe(1);
      await page.clock.runFor(1000);
      expect(attempts).toBe(1);
      if (scenario === "leave") {
        await page.evaluate(() => (window as any).stop());
        await page.clock.runFor(60000);
        expect(attempts).toBe(1);
        return;
      }
      await page.clock.runFor(scenario === "missing" ? 59000 : 4000);
      await expect.poll(() => attempts).toBe(2);
      await expect
        .poll(() => page.evaluate(() => (window as any).received))
        .toContain("recovered");
      await page.evaluate(() => (window as any).stop());
      await page.clock.runFor(10000);
      expect(attempts).toBe(2);
    });
  }
}
