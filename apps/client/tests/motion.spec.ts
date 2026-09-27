import { expect, test } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`workspace transitions remain usable with motion ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
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
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "今天想学什么？" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "用户菜单" }).click();
    await page.getByRole("button", { name: "学习档案", exact: true }).click();
    const dialog = page.getByRole("region", { name: "学习档案" });
    await expect(dialog).toBeVisible();
    const animated = await dialog.evaluate((element) =>
      element
        .getAnimations()
        .some((animation) => animation.playState === "running"),
    );
    expect(animated).toBe(reducedMotion === "no-preference");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "返回学习", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "学习地图", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "今天想学什么？" }),
    ).toBeInViewport();
    await page.getByRole("button", { name: "收起侧栏" }).click();
    await expect(page.getByRole("button", { name: "展开侧栏" })).toBeVisible();
    await page.getByRole("button", { name: "展开侧栏" }).click();
    await expect(page.getByRole("button", { name: "收起侧栏" })).toBeVisible();
  });
}
