import { expect, test } from "@playwright/test";

test("brand text remains readable in both themes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
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
  await expect(root).toHaveCSS("background-color", "rgb(246, 246, 244)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 246, 244)");
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

test("the primary action uses a thin boundary without a hard-offset shadow", async ({ page }) => {
  await page.goto("/");
  const primary = page.locator("button.primary").first();
  await expect(primary).toBeVisible();
  await expect(primary).toHaveCSS("border-top-width", "1px");
  await expect(primary).toHaveCSS("border-right-width", "1px");
  await expect(primary).toHaveCSS("box-shadow", "none");
  await expect(page.locator(".account-surface").first()).toHaveCSS(
    "border-radius",
    "8px",
  );
});

test("form control boundaries remain distinguishable in both themes", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.locator("input:not([type=checkbox]):not([type=file])").first();
  await expect(input).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const contrast = await input.evaluate((element) => {
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const s = value / 255;
            return s <= 0.04045
              ? s / 12.92
              : ((s + 0.055) / 1.055) ** 2.4;
          });
        return (
          channels[0] * 0.2126 +
          channels[1] * 0.7152 +
          channels[2] * 0.0722
        );
      };
      const style = getComputedStyle(element);
      const boundary = luminance(style.borderTopColor);
      const background = luminance(style.backgroundColor);
      return (
        (Math.max(boundary, background) + 0.05) /
        (Math.min(boundary, background) + 0.05)
      );
    });
    expect(contrast, `${theme} input boundary contrast`).toBeGreaterThanOrEqual(
      3,
    );
  }
});
