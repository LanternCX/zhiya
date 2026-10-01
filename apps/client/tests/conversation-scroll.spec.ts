import { expect, test, type WebSocketRoute } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";
import type { CourseProjection } from "../../../packages/learning/src/domain/agent";
import type { AgentSnapshot } from "../src/transport/agent";

for (const { name, reducedMotion, viewport } of [
  {
    name: "desktop",
    reducedMotion: "no-preference",
    viewport: { width: 1440, height: 1000 },
  },
  {
    name: "reduced motion",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
  },
  {
    name: "mobile",
    reducedMotion: "no-preference",
    viewport: { width: 390, height: 844 },
  },
] as const) {
  test(`streaming follows the bottom but respects scrolling back (${name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion });
    await completedOnboarding(page);
    await page.route("**/api/learning/model", (route) =>
      route.fulfill({ json: { id: "test", available: true } }),
    );
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
    const lesson = {
      messages: [
        {
          id: 1,
          role: "assistant" as const,
          text: Array.from(
            { length: 60 },
            (_, i) => `第 ${i + 1} 段教学内容。`,
          ).join("\n\n"),
          streaming: true,
        },
      ],
      pages: [],
      presentations: [],
      currentPresentationId: "",
    };
    const course = {
      id: "course",
      title: "滚动课堂",
      topic: "编程",
      status: "active" as const,
      cover: { motif: "orbit" as const, palette: "sprout" as const, label: "CODE" },
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
            {
              id: "live",
              sectionId: "section",
              title: "生成中的对话",
              state: lesson,
              createdAt: "2026-10-01",
              updatedAt: "2026-10-01",
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
    const state: AgentSnapshot<CourseProjection>["state"] = {
      course,
      conversationId: "live",
      lesson: structuredClone(lesson),
      busy: true,
      generating: false,
    };
    let revision = 1;
    let socket: WebSocketRoute | undefined;
    const snapshot = () => ({ id: "scroll-session", revision, state });
    await page.route("**/api/agent/sessions", (route) =>
      route.request().postDataJSON().kind === "course"
        ? route.fulfill({ status: 201, json: snapshot() })
        : route.fallback(),
    );
    await page.routeWebSocket(
      "**/api/agent/sessions/scroll-session/socket*",
      (ws) => {
        socket = ws;
        ws.send(JSON.stringify(snapshot()));
      },
    );
    const append = (text: string) => {
      state.lesson.messages[0].text += "\n\n" + text;
      revision++;
      socket!.send(JSON.stringify(snapshot()));
    };
    await page.goto("/#/courses/course/conversations/live");
    const thread = page.locator(".course-thread");
    const distanceFromBottom = () =>
      thread.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      );
    await expect.poll(() => Boolean(socket)).toBe(true);
    await expect(thread).toContainText("第 60 段教学内容。");
    await thread.hover();
    await expect.poll(async () => {
      await page.mouse.wheel(0, 10000);
      return distanceFromBottom();
    }).toBeLessThan(2);

    append("仍在底部跟随。\n\n继续生成下一段。");
    await expect(thread).toContainText("继续生成下一段。");
    await expect.poll(distanceFromBottom).toBeLessThan(2);

    await thread.hover();
    await page.mouse.wheel(0, -600);
    await expect.poll(distanceFromBottom).toBeGreaterThan(400);
    const readingPosition = await thread.evaluate((element) => element.scrollTop);
    append("上翻时继续生成，但不要抢走阅读位置。");
    await expect(thread).toContainText("上翻时继续生成，但不要抢走阅读位置。");
    // Observe several frames so an in-flight smooth scroll cannot pass unnoticed.
    const drift = await thread.evaluate(
      async (element, position) => {
        const end = performance.now() + 500;
        let maximum = 0;
        while (performance.now() < end) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          maximum = Math.max(maximum, Math.abs(element.scrollTop - position));
        }
        return maximum;
      },
      readingPosition,
    );
    expect(drift).toBeLessThan(2);

    await page.mouse.wheel(0, 10000);
    await expect.poll(distanceFromBottom).toBeLessThan(2);
    append("回到底部后恢复跟随。\n\n这里是最新生成的文字。");
    await expect(thread).toContainText("这里是最新生成的文字。");
    await expect.poll(distanceFromBottom).toBeLessThan(2);

    await page.mouse.wheel(0, -600);
    await expect.poll(distanceFromBottom).toBeGreaterThan(400);
    const positionBeforeCompletion = await thread.evaluate(
      (element) => element.scrollTop,
    );
    state.lesson.messages[0].streaming = false;
    state.busy = false;
    append("生成结束也保持阅读位置。");
    await expect(thread).toContainText("生成结束也保持阅读位置。");
    await expect(page.getByRole("status", { name: "生成状态" })).toHaveCount(0);
    expect(await thread.evaluate((element) => element.scrollTop)).toBe(
      positionBeforeCompletion,
    );
  });
}
