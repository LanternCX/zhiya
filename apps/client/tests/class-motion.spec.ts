import { expect, test } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`class dialogs animate and restore keyboard focus with motion ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await completedOnboarding(page);
    await page.route("**/api/me", route => route.fulfill({ json: {
      id: "self", role: "teacher", nickname: "林老师", avatar: "", email: "teacher@example.com",
    } }));
    await page.route("**/api/classes", route => route.fulfill({ json: { classes: [] } }));
    await page.route("**/api/courses", route => route.fulfill({ json: { courses: [] } }));
    await page.goto("/#/classes");
    const trigger = page.getByRole("button", { name: "创建班级", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "创建班级", exact: true });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element => element.getAnimations().length > 0)).toBe(reducedMotion === "no-preference");
    await dialog.getByLabel("班级名称").fill("探索班");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog.getByLabel("班级名称")).toHaveValue("");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
