import { expect, test, type WebSocketRoute } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";
import type { CourseProjection } from "../../../packages/learning/src/domain/agent";
import type { AgentSnapshot } from "../src/transport/agent";

test("running conversations stay visible and resume live updates after navigation, reload and reconnect", async ({
  page,
}) => {
  await completedOnboarding(page);
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        id: "student",
        nickname: "小芽",
        email: "student@example.com",
        avatar: "",
      },
    }),
  );
  await page.route("**/api/learning/model", (route) =>
    route.fulfill({ json: { id: "test", available: true } }),
  );
  const lesson = {
    messages: [
      { id: 1, role: "assistant" as const, text: "第一段", streaming: true },
    ],
    pages: [],
    presentations: [],
    currentPresentationId: "",
  };
  const conversation = {
    id: "live",
    sectionId: "section",
    title: "持续生成的对话",
    state: lesson,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
  };
  const course = {
    id: "course",
    title: "实时课堂",
    topic: "编程",
    status: "active" as const,
    cover: {
      motif: "orbit" as const,
      palette: "sprout" as const,
      label: "CODE",
    },
    conversationId: "live",
    state: lesson,
    sections: [
      {
        id: "section",
        title: "练习",
        objective: "练习",
        position: 0,
        status: "active" as const,
        conversations: [
          conversation,
          {
            ...conversation,
            id: "other",
            title: "另一个对话",
            state: { ...lesson, messages: [] },
          },
        ],
      },
    ],
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
  };
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [course] } }),
  );
  let revision = 1;
  let state: AgentSnapshot<CourseProjection>["state"] = {
    course,
    conversationId: "live",
    lesson: structuredClone(lesson),
    busy: true,
    generating: false,
  };
  const views = new Set<WebSocketRoute>();
  const feeds = new Set<WebSocketRoute>();
  const statuses = () => ({
    sessions: [
      {
        id: "live-session",
        kind: "course",
        courseId: "course",
        conversationId: "live",
        running: state.busy || state.generating,
        revision,
      },
    ],
  });
  const publish = () => {
    revision++;
    for (const socket of views)
      socket.send(JSON.stringify({ id: "live-session", revision, state }));
    for (const socket of feeds) socket.send(JSON.stringify(statuses()));
  };
  await page.route("**/api/agent/sessions", (route) => {
    const input = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      json:
        input.conversationId === "live"
          ? { id: "live-session", revision, state }
          : {
              id: "other-session",
              revision,
              state: {
                ...state,
                conversationId: "other",
                busy: false,
                generating: false,
                lesson: { ...lesson, messages: [] },
              },
            },
    });
  });
  await page.route("**/api/agent/sessions/*/commands", (route) => {
    const command = route.request().postDataJSON();
    state = {
      ...state,
      commands: {
        ...state.commands,
        [command.requestId]: { status: "complete" },
      },
    };
    publish();
    return route.fulfill({ status: 202, json: { ok: true } });
  });
  await page.routeWebSocket("**/api/agent/socket*", (socket) => {
    feeds.add(socket);
    socket.onClose(() => feeds.delete(socket));
    socket.send(JSON.stringify(statuses()));
  });
  await page.routeWebSocket("**/api/agent/sessions/*/socket*", (socket) => {
    if (!socket.url().includes("live-session")) {
      socket.send(
        JSON.stringify({
          id: "other-session",
          revision,
          state: {
            ...state,
            conversationId: "other",
            busy: false,
            generating: false,
            lesson: { ...lesson, messages: [] },
          },
        }),
      );
      return;
    }
    views.add(socket);
    socket.onClose(() => views.delete(socket));
    socket.send(JSON.stringify({ id: "live-session", revision, state }));
  });
  await page.goto("/#/courses/course/conversations/live");
  const navigation = page.getByRole("navigation", { name: "最近对话" });
  const live = navigation
    .getByRole("link")
    .filter({ hasText: "持续生成的对话" });
  await expect(live.getByRole("status", { name: "正在生成" })).toBeVisible();
  await expect(page.getByRole("status", { name: "生成状态" })).toBeVisible();
  await expect(page.getByRole("status", { name: "生成状态" })).toHaveText("");
  await expect(live.getByRole("status", { name: "正在生成" })).toHaveText("");
  await expect(page.getByText("第一段", { exact: true })).toBeVisible();
  await navigation.getByRole("link").filter({ hasText: "另一个对话" }).click();
  await expect(page).toHaveURL(/conversations\/other$/);
  state.lesson.messages[0].text = "第一段，离开时继续生成";
  publish();
  await expect(live.getByRole("status", { name: "正在生成" })).toBeVisible();
  await live.click();
  await expect(
    page.getByText("第一段，离开时继续生成", { exact: true }),
  ).toBeVisible();
  state.lesson.messages[0].text += "，返回后仍在更新";
  publish();
  await expect(
    page.getByText(/返回后仍在更新/, { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(live.getByRole("status", { name: "正在生成" })).toBeVisible();
  await expect(
    page.getByText(/返回后仍在更新/, { exact: false }),
  ).toBeVisible();
  await expect.poll(() => views.size).toBeGreaterThan(0);
  for (const socket of [...views])
    socket.close({ code: 1012, reason: "test reconnect" });
  await expect(page.getByRole("status", { name: "实时同步" })).toBeVisible();
  await expect(page.getByRole("status", { name: "实时同步" })).toHaveText("");
  await expect(page.getByRole("status", { name: "实时同步" })).toHaveAttribute(
    "title",
    "正在重新连接",
  );
  state.lesson.messages[0].text += "，断线期间的内容";
  publish();
  await expect(
    page.getByText(/断线期间的内容/, { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("status", { name: "实时同步" })).toHaveCount(0);
  for (const socket of [...feeds])
    socket.close({ code: 1012, reason: "test status reconnect" });
  state.lesson.messages[0].text = "最终回答";
  state.lesson.messages[0].streaming = false;
  state.busy = false;
  publish();
  await expect(page.getByText("最终回答", { exact: true })).toBeVisible();
  await expect(live.getByRole("status", { name: "正在生成" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "生成状态" })).toHaveCount(0);
});
