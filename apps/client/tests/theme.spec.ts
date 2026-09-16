import { expect, test } from "@playwright/test";

test("brand text remains readable in both themes", async ({ page }) => {
  await page.goto("/");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const contrast = await page.locator(".brand .wordmark").first().evaluate((element) => {
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
          const s = value / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const foreground = luminance(getComputedStyle(element).color);
      const background = luminance(getComputedStyle(document.body).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast, `${theme} brand contrast`).toBeGreaterThanOrEqual(4.5);
  }
});

test("theme cycles, persists, and follows the system only in automatic mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(root).toHaveCSS("background-color", "rgb(30, 30, 30)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(30, 30, 30)");
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
