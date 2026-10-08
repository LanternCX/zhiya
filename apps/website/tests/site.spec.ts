import { expect, test } from "@playwright/test";

test("keeps navigation usable without horizontal overflow on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("./");

  await page.getByRole("button", { name: "打开导航" }).click();
  const navigation = page.getByRole("navigation", { name: "主导航" });
  await expect(navigation.getByRole("link", { name: "认识知芽", exact: true })).toBeVisible();
  await navigation.getByRole("link", { name: "认识知芽", exact: true }).click();
  await expect(page.locator("#start")).toBeInViewport();

  const sizes = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
});

test("supports keyboard focus, theme choice, and reduced motion", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("./");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "主题：自动；切换至浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: "主题：浅色；切换至深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "主题：深色；切换至自动" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到主要内容" })).toBeFocused();
  await expect(page.locator(".opening-scene")).toHaveCount(0);
});

test("keeps the page and theme usable when browser storage is denied", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() { throw new DOMException("Storage blocked", "SecurityError"); },
    });
  });
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "知芽" })).toBeVisible();
  await page.getByRole("button", { name: "主题：自动；切换至浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(errors).toEqual([]);
});

test("closes phone navigation with Escape and returns keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link").first().focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeHidden();
  await expect(page.getByRole("button", { name: "打开导航" })).toBeFocused();
  await expect(page.getByRole("link", { name: "GitHub 仓库", exact: true })).toBeVisible();
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 1366, height: 768 }, { width: 768, height: 1024 }, { width: 414, height: 896 }, { width: 390, height: 844 }, { width: 375, height: 812 }, { width: 320, height: 740 }]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`renders readable content and teaching artwork at ${viewport.width}px in ${colorScheme}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("./");
      await expect(page.getByRole("heading", { level: 1, name: "知芽" })).toBeInViewport();
      const overflow = await page.locator("main, header, footer").evaluateAll(roots =>
        roots.flatMap(root => Array.from(root.querySelectorAll("*"))).filter(element => {
          // These conveyors deliberately extend inside their clipped viewports.
          if (element.closest(".hero-notes, .ribbon-window")) return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
        }).map(element => element.tagName + "." + element.className),
      );
      expect(overflow).toEqual([]);
      for (const control of await page.locator("header button, header a").all()) {
        if (!(await control.isVisible())) continue;
        const bounds = await control.boundingBox();
        expect(bounds!.width).toBeGreaterThanOrEqual(44);
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: testInfo.outputPath("first-viewport.png") });
      await page.screenshot({ path: testInfo.outputPath("full-page.png"), fullPage: true });
    });
  }
}
