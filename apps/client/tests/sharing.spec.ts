import { expect, test } from "@playwright/test";

test("a guest reads a shared presentation, flips pages and sees updates on refresh", async ({
  page,
}, testInfo) => {
  let text = "公开的讲解内容";
  let available = true;
  await page.route("**/api/shares/public-link", (route) =>
    available
      ? route.fulfill({
          json: {
            deliverable: {
              id: "classroom",
              title: "认识人工智能",
              kind: "presentation",
              revision: 1,
              updatedAt: "2026-10-05",
              blocks: [
                {
                  id: "one",
                  title: "第一张课件",
                  markdown: text,
                  imageIds: [],
                },
                {
                  id: "two",
                  title: "第二张课件",
                  markdown: "下一页内容",
                  imageIds: [],
                },
              ],
            },
          },
        })
      : route.fulfill({ status: 404, json: { error: "未找到分享内容" } }),
  );
  await page.goto("/#/shares/public-link");
  await expect(
    page.getByRole("heading", { name: "认识人工智能", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(text)).toBeVisible();
  await expect(page.getByText("下一页内容")).toBeHidden();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByText("下一页内容")).toBeVisible();
  await page.getByRole("button", { name: "阅读全部", exact: true }).click();
  await expect(page.getByText(text)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("shared-presentation-mobile.png"),
  });
  text = "更新后的讲解内容";
  await page.reload();
  await expect(page.getByText(text)).toBeVisible();
  available = false;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("分享");
  await expect(page.getByText(text)).toHaveCount(0);
});
