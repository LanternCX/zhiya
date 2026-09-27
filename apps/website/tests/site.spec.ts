import { expect, test } from "@playwright/test";

test("presents course learning and navigates to multimodal teaching", async ({
  page,
}) => {
  await page.goto("./");

  await expect(page.getByRole("heading", { level: 1, name: "知芽" })).toBeVisible();
  await expect(page.getByText("面向 K12 的人工智能学习搭子")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();

  for (const heading of ["课程学习", "连续对话", "课堂实践"]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByText(/自由知识探索|AI 实验室|学习回顾|课程、探索与实验/)).toHaveCount(0);

  await expect(page.getByText(/项目进展|正在构建|待验收|尚未开放|产品规划/)).toHaveCount(0);
  await page.getByRole("navigation").getByRole("link", { name: "多模态教学" }).click();
  await expect(page.getByRole("heading", { name: "让每一种知识，都有合适的讲法。" })).toBeInViewport();
  for (const name of ["对话与语音", "动画与绘本", "编程与练习"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }

  const links = await page.locator("a").evaluateAll((items) =>
    items.map((item) => item.getAttribute("href")),
  );
  expect(links).not.toContain("");
  expect(links).not.toContain("#");
  await expect(page.getByRole("button", { name: /语音讲解/ })).toHaveCount(0);
  await expect(page.getByText("教学概念示意", { exact: true })).toBeVisible();
});

test("can pause, seek, and replay the mathematical animation", async ({ page }) => {
  await page.clock.install();
  await page.goto("./");
  await page.keyboard.press("Escape");
  await page.locator("canvas").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "重新播放动画" }).click();
  await page.clock.runFor(300);
  const canvas = page.locator("canvas");
  await page.getByRole("button", { name: "暂停动画", exact: true }).click();
  const paused = await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL());
  await page.clock.runFor(1000);
  expect(await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL())).toBe(paused);
  await page.getByRole("button", { name: "继续动画", exact: true }).click();
  await page.clock.runFor(1500);
  expect(await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL())).not.toBe(paused);
  await page.getByRole("button", { name: "03 进行预测" }).click();
  await expect(page.getByRole("status")).toContainText("x = 8 时预测 y ≈ 5.90");
  await page.getByRole("button", { name: "重新播放动画" }).click();
  await expect(page.getByRole("status")).toContainText("观察");
});

test("keeps navigation usable without horizontal overflow on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("./");

  await page.getByRole("button", { name: "打开导航" }).click();
  const navigation = page.getByRole("navigation", { name: "主导航" });
  await expect(navigation.getByRole("link", { name: "产品体验", exact: true })).toBeVisible();
  await navigation.getByRole("link", { name: "产品体验", exact: true }).click();
  await expect(page.locator("#experience")).toBeInViewport();

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
  await expect(page.locator(".hero-visual")).toHaveCSS("animation-name", "none");
  await expect(page.getByRole("button", { name: "继续动画", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "重新播放动画" })).toBeDisabled();
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
      await expect(page.getByRole("img")).toBeVisible();
      await expect.poll(() => page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext("2d")!;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let colored = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) colored++;
        return colored;
      })).toBeGreaterThan(1000);
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
