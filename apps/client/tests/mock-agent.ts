import type { BrowserContext, Page, WebSocketRoute } from "@playwright/test";
import { CourseHost } from "../../agent/src/runtime/course";
import { ProfileHost } from "../../agent/src/runtime/profile";
import { ToolAPI, ToolAPIError } from "../../agent/src/adapters/api";

// Run Pi in the test host. Browser routes remain fixtures for model/tool responses,
// while the application under test only sends commands and receives projections.
export async function mockAgent(
  router: Page | BrowserContext,
  current: () => any,
  action: (value: any) => Promise<any> | any,
) {
  const sessions = new Map<string, any>();
  const createdConversations = new Map<string, any[]>();
  const responses = new Set<Promise<void>>();
  router.on("response", (response) => {
    const match = new URL(response.url()).pathname.match(
      /^\/api\/courses\/([^/]+)\/sections\/[^/]+\/conversations$/,
    );
    if (!match || response.request().method() !== "POST" || !response.ok())
      return;
    const pending = response
      .json()
      .then(({ conversation }) => {
        createdConversations.set(match[1], [
          ...(createdConversations.get(match[1]) ?? []),
          conversation,
        ]);
      })
      .catch(() => {})
      .finally(() => responses.delete(pending));
    responses.add(pending);
  });
  const sockets = new Map<string, Set<WebSocketRoute>>();
  const feeds = new Set<WebSocketRoute>();
  const publishStatuses = () => {
    const statuses = [...new Set(sessions.values())].map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      courseId: entry.state.course?.id ?? "",
      conversationId: entry.state.conversationId ?? "",
      running: Boolean(
        entry.state.running || entry.state.busy || entry.state.generating,
      ),
    }));
    for (const socket of feeds) {
      try {
        socket.send(JSON.stringify({ sessions: statuses }));
      } catch {}
    }
  };
  await router.routeWebSocket("**/api/agent/socket*", (socket) => {
    feeds.add(socket);
    socket.onClose(() => feeds.delete(socket));
    publishStatuses();
  });
  const streams = new Map<
    string,
    {
      resolve: (response: Response) => void;
      reject: (error: Error) => void;
      controller: ReadableStreamDefaultController<Uint8Array>;
    }
  >();
  const binding = "agentTestStream" + Math.random().toString(36).slice(2);
  await router.exposeBinding(binding, (_source, part: any) => {
    const stream = streams.get(part.id);
    if (!stream) return;
    if (part.status)
      stream.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream.controller = controller;
            },
          }),
          { status: part.status, headers: part.headers },
        ),
      );
    if (part.bytes) stream.controller.enqueue(new Uint8Array(part.bytes));
    if (part.done) {
      stream.controller.close();
      streams.delete(part.id);
    }
    if (part.error) {
      const error = new Error(part.error);
      stream.controller?.error(error);
      stream.reject(error);
      streams.delete(part.id);
    }
  });
  const request = (
    page: Page,
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
    headers?: Record<string, string>,
  ) =>
    new Promise<Response>((resolve, reject) => {
      const id = crypto.randomUUID();
      streams.set(id, { resolve, reject, controller: undefined! });
      void page
        .evaluate(
          async ({ id, path, method, body, binding, headers }) => {
            const root = window as any;
            root.agentTestRequests ??= new Map();
            const controller = new AbortController();
            root.agentTestRequests.set(id, controller);
            try {
              const external = path.startsWith("http");
              const response = await fetch(external ? path : "/api" + path, {
                method,
                headers: external
                  ? headers
                  : {
                      "Content-Type": "application/json",
                      "X-Zhiya-Request": "1",
                    },
                body:
                  body === undefined
                    ? undefined
                    : external
                      ? Array.isArray(body) ? new Uint8Array(body) : String(body)
                      : JSON.stringify(body),
                signal: controller.signal,
              });
              await root[binding]({
                id,
                status: response.status,
                headers: Object.fromEntries(response.headers),
              });
              const reader = response.body!.getReader();
              for (;;) {
                const part = await reader.read();
                if (part.done) break;
                await root[binding]({ id, bytes: Array.from(part.value) });
              }
              await root[binding]({ id, done: true });
            } catch (error) {
              await root[binding]({ id, error: String(error) });
            } finally {
              root.agentTestRequests.delete(id);
            }
          },
          { id, path, method, body, binding, headers },
        )
        .catch((error) => {
          streams.delete(id);
          reject(error);
        });
      signal?.addEventListener(
        "abort",
        () => {
          void page
            .evaluate(
              (id) => (window as any).agentTestRequests?.get(id)?.abort(),
              id,
            )
            .catch(() => {});
        },
        { once: true },
      );
    });
  const publish = (entry: any) => {
    publishStatuses();
    entry.revision++;
    const snapshot = {
      id: entry.id,
      revision: entry.revision,
      state: entry.state,
    };
    for (const socket of sockets.get(entry.id) ?? [])
      try {
        socket.send(JSON.stringify(snapshot));
      } catch {}
  };
  await router.route("**/api/agent/sessions", async (route) => {
    const input = route.request().postDataJSON();
    const key =
      input.kind + ":" + (input.conversationId ?? crypto.randomUUID());
    let entry = sessions.get(key);
    if (!entry) {
      const page = route.request().frame().page();
      let course: any = null;
      if (input.courseId) {
        const response = await request(page, "/courses");
        const data = await response.json();
        course =
          data.courses?.find((item: any) => item.id === input.courseId) ?? null;
      }
      await Promise.all(responses);
      if (course)
        course = {
          ...course,
          sections: course.sections?.map((section: any) => ({
            ...section,
            conversations: [
              ...section.conversations,
              ...(createdConversations.get(course.id) ?? []).filter(
                (item) =>
                  item.sectionId === section.id &&
                  !section.conversations.some((old: any) => old.id === item.id),
              ),
            ],
          })),
        };
      const conversation = course?.sections
        ?.flatMap((section: any) => section.conversations)
        .find((item: any) => item.id === input.conversationId);
      const state =
        input.kind === "profile"
          ? { conversation: current(), busy: false }
          : {
              course,
              conversationId: input.conversationId ?? "",
              lesson: conversation?.state ??
                (input.conversationId ? course?.state : undefined) ?? {
                  messages: [],
                  pages: [],
                  presentations: [],
                  currentPresentationId: "",
                },
              busy: false,
              generating: false,
            };
      entry = {
        id: crypto.randomUUID(),
        revision: 1,
        state,
        kind: input.kind,
        page,
      };
      sessions.set(key, entry);
      sessions.set(entry.id, entry);
    }
    await route.fulfill({
      status: 201,
      json: { id: entry.id, revision: entry.revision, state: entry.state },
    });
  });
  await router.routeWebSocket("**/api/agent/sessions/*/socket*", (socket) => {
    const id = new URL(socket.url()).pathname.split("/")[4];
    const entry = sessions.get(id);
    if (!entry) return;
    if (!sockets.has(id)) sockets.set(id, new Set());
    sockets.get(id)!.add(socket);
    socket.onClose(() => sockets.get(id)?.delete(socket));
    socket.send(
      JSON.stringify({ id, revision: entry.revision, state: entry.state }),
    );
  });
  await router.route("**/api/agent/sessions/*/commands", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[4];
    const entry = sessions.get(id);
    const command = route.request().postDataJSON();
    if (!entry) {
      await route.fulfill({ status: 404, json: { error: "missing session" } });
      return;
    }
    if (!entry.host && !entry.opening) {
      entry.opening = (async () => {
        class API extends ToolAPI {
          override object(url: string, init?: RequestInit) {
            return request(
              entry.page,
              url,
              init?.method ?? "GET",
              init?.body instanceof Uint8Array ? Array.from(init.body) : init?.body,
              undefined,
              init?.headers as Record<string, string>,
            );
          }
          override async request(
            path: string,
            method = "GET",
            body?: any,
            signal?: AbortSignal,
          ): Promise<Response> {
            if (path.endsWith("/state")) {
              if (
                entry.kind === "course" &&
                body.course &&
                body.conversationId
              ) {
                const response = await request(
                  entry.page,
                  `/courses/${body.course.id}/conversation`,
                  "PUT",
                  { conversationId: body.conversationId, state: body.lesson },
                );
                if (!response.ok && response.status !== 401)
                  throw new ToolAPIError(
                    response.status,
                    "课程进度暂时无法保存",
                  );
                const listed = await (
                  await request(entry.page, "/courses")
                ).json();
                const canonical = listed.courses?.find(
                  (course: any) => course.id === body.course.id,
                );
                if (canonical)
                  entry.state.course = {
                    ...entry.state.course,
                    ...canonical,
                    sections: entry.state.course.sections?.map(
                      (section: any) => {
                        const saved = canonical.sections?.find(
                          (item: any) => item.id === section.id,
                        );
                        return {
                          ...section,
                          conversations: section.conversations.map(
                            (conversation: any) => ({
                              ...conversation,
                              ...saved?.conversations.find(
                                (item: any) => item.id === conversation.id,
                              ),
                            }),
                          ),
                        };
                      },
                    ),
                    conversationId: entry.state.conversationId,
                    state: entry.state.lesson,
                  };
              }
              publish(entry);
              return Response.json({ ok: true });
            }
            if (path.startsWith("/learning?") || path === "/learning") {
              if (path.includes("?"))
                await new Promise((resolve) => setTimeout(resolve, 20));
              return Response.json(current());
            }
            if (path === "/learning/action") {
              const result = await action(body.action);
              return Response.json({
                state: result.state ?? current(),
                data: result.data ?? result.state,
              });
            }
            const mapped =
              path === "/course/model" ? "/learning/course/model" : path;
            if (
              method === "GET" &&
              path === `/courses/${entry.state.course?.id}`
            )
              return Response.json({ course: entry.state.course });
            const response = await request(
              entry.page,
              mapped,
              method,
              body,
              signal,
            );
            if (!response.ok && !path.endsWith("/model")) {
              const error = await response.json();
              throw new ToolAPIError(
                response.status,
                error.error ?? "操作失败",
              );
            }
            return response;
          }
        }
        const api = new API("http://test.invalid", "test", id, "test");
        const model = await (
          await request(entry.page, "/learning/model")
        ).json();
        entry.host =
          entry.kind === "course"
            ? new CourseHost(api, model, current().memory ?? "", entry.state)
            : new ProfileHost(api, model, entry.state);
        const cleanup = () => entry.host.stop();
        entry.page.once("close", cleanup);
      })();
    }
    try {
      await entry.opening;
    } catch (error) {
      if (entry.page.isClosed()) return;
      await route.fulfill({ status: 503, json: { error: String(error) } });
      return;
    }
    entry.state.commands ??= {};
    if (!entry.state.commands[command.requestId]) {
      entry.state.commands[command.requestId] = { status: "running" };
      void entry.host
        .command(command.action, command.args)
        .then(
          () => {
            entry.state.commands[command.requestId] = { status: "complete" };
          },
          (error: Error) => {
            entry.state.commands[command.requestId] = {
              status: "failed",
              error: error.message,
            };
          },
        )
        .finally(() => publish(entry));
    }
    publish(entry);
    await route.fulfill({ status: 202, json: { ok: true } });
  });
}
