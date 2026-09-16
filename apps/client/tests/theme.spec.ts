import { expect, test } from "@playwright/test";

test("theme cycles, persists, and follows the system only in automatic mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(root).toHaveCSS("background-color", "rgb(14, 23, 28)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(14, 23, 28)");
  await page.getByRole("button", { name: "当前为自动主题，切换至浅色主题" }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(root).toHaveCSS("background-color", "rgb(248, 250, 228)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(248, 250, 228)");
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "当前为浅色主题，切换至深色主题" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "当前为深色主题，切换至自动主题" }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "dark");
});

test("the primary action has a visible border and hard-offset shadow", async ({ page }) => {
  await page.goto("/");
  const primary = page.locator("button.primary").first();
  await expect(primary).toBeVisible();
  await expect(primary).toHaveCSS("border-top-width", "3px");
  await expect(primary).toHaveCSS("border-right-width", "3px");
  await expect(primary).toHaveCSS("box-shadow", /4px 4px/);
});
