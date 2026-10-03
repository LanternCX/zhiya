import { expect, test } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";

for (const mode of ["normal", "retry", "pagination"] as const) {
  test(`material citations open revision-specific excerpts (${mode})`, async ({
    page,
  }, testInfo) => {
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
    const id = "cc902a68-6d88-4e39-8a54-854e6f3ca182";
    const citation = `[变量笔记.docx](#material/${id}/1/4-12,42-47,74-75)`;
    const state = {
      messages: [
        {
          id: 1,
          role: "assistant",
          text: `变量可以保存数据。${citation}\n\n普通链接：[官网](https://example.com)。\n\n示例：\`${citation}\`\n\n\`\`\`text\n${citation}\n\`\`\``,
        },
      ],
      pages: [],
      presentations: [],
      currentPresentationId: "",
    };
    const course = {
      id: "citation-course",
      conversationId: "citation-chat",
      title: "引用测试",
      topic: "变量",
      status: "active",
      cover: { motif: "code", palette: "sprout", label: "学习" },
      state,
      sections: [
        {
          id: "section",
          title: "变量",
          objective: "学习变量",
          position: 0,
          status: "active",
          conversations: [
            {
              id: "citation-chat",
              sectionId: "section",
              title: "学习",
              state,
              createdAt: "2026-10-03T00:00:00Z",
              updatedAt: "2026-10-03T00:00:00Z",
            },
          ],
        },
      ],
      createdAt: "2026-10-03T00:00:00Z",
      updatedAt: "2026-10-03T00:00:00Z",
    };
    await page.route("**/api/courses", (route) =>
      route.fulfill({ json: { courses: [course] } }),
    );
    const requested: string[] = [];
    let failed = false;
    await page.route(
      `**/api/courses/citation-course/materials/${id}/content?*`,
      (route) => {
        const url = new URL(route.request().url());
        requested.push(url.search);
        const start = Number(url.searchParams.get("startLine"));
        if (mode === "retry" && start === 42 && !failed) {
          failed = true;
          return route.fulfill({
            status: 503,
            json: { error: "暂时无法读取引用" },
          });
        }
        return route.fulfill({
          json: {
            material: { id, name: "变量笔记.docx" },
            revision: 1,
            excerpt: {
              status: "partial",
              warnings: ["第 3 页图片未识别"],
              totalLines: 82,
              nextLine: mode === "pagination" && start === 42 ? 43 : undefined,
              lines: [
                {
                  number: start,
                  text: `引用内容 ${start}`,
                  kind: start === 74 ? "description" : "text",
                  source: { page: 2 },
                },
              ],
            },
          },
        });
      },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "打开课程：引用测试" }).click();
    await page.getByRole("button", { name: "打开小节：变量" }).click();
    const chip = page.getByRole("button", { name: "查看引用：变量笔记.docx" });
    await expect(chip).toHaveCount(1);
    await expect(
      page.locator(".course-message-body p").first(),
    ).not.toContainText(id);
    expect(requested).toHaveLength(0);
    await expect(page.getByRole("link", { name: "官网" })).toHaveAttribute(
      "href",
      "https://example.com/",
    );
    await chip.click();
    const panel = page.getByRole("dialog", { name: "文件引用" });
    if (mode === "retry") {
      await expect(panel.getByRole("alert")).toContainText("暂时无法读取引用");
      await panel.getByRole("button", { name: "重试" }).click();
    }
    await expect(panel).toContainText("引用内容 4");
    await expect(panel).toContainText("引用内容 42");
    await expect(panel).toContainText("引用内容 74");
    await expect(panel).toContainText("第 2 页");
    await expect(panel).toContainText("模型描述");
    await expect(panel).toContainText("第 3 页图片未识别");
    const expected = [
      "?revision=1&startLine=4&endLine=12",
      "?revision=1&startLine=42&endLine=47",
      "?revision=1&startLine=74&endLine=75",
    ];
    if (mode === "retry") expected.push(...expected);
    if (mode === "pagination") {
      expected.push("?revision=1&startLine=43&endLine=47");
      await expect(panel).toContainText("引用内容 43");
    }
    expect(requested.sort()).toEqual(expected.sort());
    if (mode === "normal") {
      await page.screenshot({
        path: testInfo.outputPath("citation-desktop.png"),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(panel).toBeInViewport();
      const bounds = await panel.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      await page.screenshot({
        path: testInfo.outputPath("citation-mobile.png"),
      });
    }
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });
}
