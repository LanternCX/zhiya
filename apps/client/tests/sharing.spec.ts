import { expect, test } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
test(`a guest reads, flips and refreshes a shared presentation with motion ${reducedMotion}`, async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion });
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
  const slide = page.locator("section").filter({ has: page.getByRole("heading", { name: "第二张课件" }) });
  expect(await slide.evaluate(element => element.getAnimations().length > 0)).toBe(reducedMotion === "no-preference");
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByText(text)).toBeHidden();
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
    animations: "disabled",
  });
  text = "更新后的讲解内容";
  await page.getByRole("button", { name: "刷新内容" }).click();
  await expect(page.getByText(text)).toBeVisible();
  available = false;
  await page.getByRole("button", { name: "刷新内容" }).click();
  await expect(page.getByRole("alert")).toContainText("分享");
  await expect(page.getByText(text)).toHaveCount(0);
});
}
