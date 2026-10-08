import { expect, test } from "@playwright/test";

test("opening finishes automatically and can be skipped with Escape", async ({ page }) => {
  await page.clock.install();
  await page.goto("./");
  await expect(page.locator(".opening-scene")).toBeVisible();
  await page.clock.runFor(4200);
  await expect(page.locator(".opening-scene")).toHaveCount(0);
  await page.reload();
  await page.keyboard.press("Escape");
  await expect(page.locator(".opening-scene")).toHaveCount(0);
  await page.clock.runFor(4200);
  await page.getByRole("link", { name: /了解知芽/ }).click();
  await expect(page.locator("#start")).toBeInViewport();
});

test("reduced motion bypasses opening and retains content and tab navigation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await expect(page.locator(".opening-scene")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "知芽" })).toBeVisible();
  const demo = page.getByRole('region', { name: '交互课堂演示' });
  await demo.getByRole('button', { name: '语音对话', exact: true }).click();
  await expect(demo.frameLocator('iframe').frameLocator('iframe[title="课件页面：说出来，也随时插一句"]').getByText(/不采集麦克风/)).toBeVisible();
});

test("scroll parallax moves layers and stops when reduced motion is enabled", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "跳过开屏" }).click();
  const notes = page.locator(".hero-content");
  const before = await notes.evaluate(el => getComputedStyle(el).translate);
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
  await expect.poll(() => notes.evaluate(el => getComputedStyle(el).translate)).not.toBe(before);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(notes).toHaveCSS("translate", "none");
  await expect(page.locator(".hero-content")).toHaveCSS("translate", "none");
});

test("decorative conveyors can be paused and resumed together", async ({ page }) => {
  await page.goto("./");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "暂停装饰滚动" }).click();
  for (const track of await page.locator(".notes-track, .ribbon-track").all()) {
    await expect(track).toHaveCSS("animation-play-state", "paused");
  }
  await page.getByRole("button", { name: "继续装饰滚动" }).click();
  await page.mouse.move(700, 400);
  await page.getByRole("button", { name: "暂停装饰滚动" }).blur();
  await expect(page.locator(".ribbon-track")).toHaveCSS("animation-play-state", "running");
  const start = await page.locator(".notes-track").first().evaluate(el => getComputedStyle(el).transform);
  await expect.poll(() => page.locator(".notes-track").first().evaluate(el => getComputedStyle(el).transform)).not.toBe(start);
});
