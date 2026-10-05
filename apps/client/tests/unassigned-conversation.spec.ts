import { expect, test, type WebSocketRoute } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";
import type { AgentSnapshot } from "../src/transport/agent";
import type { CourseProjection } from "../src/domain/agent";
import type { StoredCourse } from "../src/domain/learning";

for (const withinCourse of [false, true]) {
  test(`a reply without a course tool remains in history and resumes after reload (${withinCourse ? "course without section" : "without course"})`, async ({
    page,
  }) => {
    await completedOnboarding(page);
    await page.route("**/api/me", (route) =>
      route.fulfill({
        json: {
          id: "learner",
          nickname: "小芽",
          email: "learner@example.com",
          avatar: "",
        },
      }),
    );
    await page.route("**/api/learning/model", (route) =>
      route.fulfill({ json: { id: "test", available: true } }),
    );
    let revision = 1;
    let creations = 0;
    const state: AgentSnapshot<CourseProjection>["state"] = {
      course: null,
      conversationId: "unassigned",
      busy: false,
      generating: false,
      lesson: {
        messages: [],
        pages: [],
        presentations: [],
        currentPresentationId: "",
      },
    };
    const course: StoredCourse = {
      id: "existing-course",
      title: "认识科学",
      topic: "科学",
      status: "active",
      cover: { motif: "orbit", palette: "sprout", label: "SCIENCE" },
      sections: [],
      state: structuredClone(state.lesson),
      conversationId: "",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    };
    if (withinCourse) state.course = course;
    await page.route("**/api/courses", (route) =>
      route.fulfill({ json: { courses: withinCourse ? [course] : [] } }),
    );
    const views = new Set<WebSocketRoute>();
    const feeds = new Set<WebSocketRoute>();
    const history = () => ({
      sessions: [
        {
          id: "execution",
          kind: "course",
          courseId: withinCourse ? course.id : "",
          conversationId: "unassigned",
          running: state.busy,
        },
      ],
      conversations: state.lesson.messages.length
        ? [
            {
              id: "unassigned",
              courseId: withinCourse ? course.id : "",
              sectionId: "",
              title: "为什么天空是蓝色的",
              updatedAt: "2026-10-01T00:00:00Z",
            },
          ]
        : [],
    });
    const snapshot = () => ({ id: "execution", revision, state });
    const publish = () => {
      revision++;
      for (const socket of views) socket.send(JSON.stringify(snapshot()));
      for (const socket of feeds) socket.send(JSON.stringify(history()));
    };
    await page.route("**/api/agent/sessions", (route) => {
      const input = route.request().postDataJSON();
      if (input.kind !== "course") return route.fallback();
      if (!input.conversationId) creations++;
      else expect(input.conversationId).toBe("unassigned");
      return route.fulfill({ status: 201, json: snapshot() });
    });
    await page.route("**/api/agent/sessions/*/commands", (route) => {
      const command = route.request().postDataJSON();
      if (command.action === "prompt") {
        const id = state.lesson.messages.length + 1;
        state.lesson.messages.push(
          { id, role: "user", text: command.args[0] },
          {
            id: id + 1,
            role: "assistant",
            text:
              command.args[0] === "继续解释"
                ? "这是接着刚才的回答"
                : "先聊聊你的问题",
          },
        );
      }
      state.commands ??= {};
      state.commands[command.requestId] = { status: "complete" };
      publish();
      return route.fulfill({ status: 202, json: { ok: true } });
    });
    await page.routeWebSocket("**/api/agent/socket*", (socket) => {
      feeds.add(socket);
      socket.onClose(() => feeds.delete(socket));
      socket.send(JSON.stringify(history()));
    });
    await page.routeWebSocket("**/api/agent/sessions/*/socket*", (socket) => {
      views.add(socket);
      socket.onClose(() => views.delete(socket));
      socket.send(JSON.stringify(snapshot()));
    });
    await page.goto(
      withinCourse
        ? "/#/courses/existing-course/conversations/new"
        : "/#/learn",
    );
    await page
      .getByRole("textbox", { name: "告诉知芽你想学什么" })
      .fill("为什么天空是蓝色的");
    expect(creations).toBe(0);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page).toHaveURL(/#\/conversations\/unassigned$/);
    await expect(
      page.getByText("先聊聊你的问题", { exact: true }),
    ).toBeVisible();
    const recent = page.getByRole("navigation", { name: "最近对话" });
    await expect(
      recent.getByRole("link").filter({ hasText: "为什么天空是蓝色的" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("先聊聊你的问题", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "告诉知芽你想学什么" })
      .fill("继续解释");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.getByText("这是接着刚才的回答", { exact: true }),
    ).toBeVisible();
    expect(creations).toBe(1);
    await page.getByRole("button", { name: "学习地图" }).click();
    await recent
      .getByRole("link")
      .filter({ hasText: "为什么天空是蓝色的" })
      .click();
    await expect(
      page.getByText("这是接着刚才的回答", { exact: true }),
    ).toBeVisible();
    expect(creations).toBe(1);
  });
}

test("dialogue history appears in the sidebar without a duplicate list in the main panel", async ({
  page,
}) => {
  await completedOnboarding(page);
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        id: "learner",
        nickname: "小芽",
        email: "learner@example.com",
        avatar: "",
      },
    }),
  );
  await page.route("**/api/learning/model", (route) =>
    route.fulfill({ json: { available: true, id: "test" } }),
  );
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [] } }),
  );
  const conversations = Array.from({ length: 11 }, (_, i) => ({
    id: `chat-${i}`,
    courseId: "",
    sectionId: "",
    title: `保存的对话${i}`,
    updatedAt: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  await page.routeWebSocket("**/api/agent/socket*", (socket) =>
    socket.send(JSON.stringify({ sessions: [], conversations })),
  );
  await page.goto("/#/learn");
  await expect(
    page.getByRole("navigation", { name: "最近对话" }).getByRole("link"),
  ).toHaveCount(10);
  await expect(page.getByRole("main").getByRole("link", { name: /保存的对话/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "全部对话" })).toHaveCount(0);
});
