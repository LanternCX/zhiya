import { expect, test, openWebsite, reloadWebsite, pausePreviewTransitions, waitForPreview, dismissOpening, freezeOpeningClock } from './browser';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test("switching classroom scenes fades the new preview in and leaves the exercise usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await pausePreviewTransitions(page);
  await openWebsite(page);
  await dismissOpening(page);
  const demo = page.getByRole("region", { name: "交互课堂演示" });
  const control = demo.getByRole("button", { name: "随堂练习", exact: true });
  await control.click();
  await waitForPreview(demo, demo.frameLocator('iframe').getByLabel('带上雨伞', { exact: true }));
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>('#classroom iframe[src*="scene=question"]');
    const opacity = frame ? Number(getComputedStyle(frame).opacity) : 1;
    return opacity > 0 && opacity < 1;
  }, undefined, { timeout: 5000 });
  await demo.locator('iframe').evaluate(frame => frame.getAnimations().forEach(animation => animation.finish()));
  await expect(demo.locator("iframe")).toHaveCSS("opacity", "1");
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await demo.frameLocator("iframe").getByLabel("带上雨伞", { exact: true }).check();
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`scroll-driven slides transition and remain readable with motion preference ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await pausePreviewTransitions(page);
    await openWebsite(page);
    await dismissOpening(page);
    const demo = page.getByRole("region", { name: "交互课堂演示" });
    await demo.getByRole("button", { name: "图文课件", exact: true }).click();
    await waitForPreview(demo, demo.frameLocator("iframe").locator('iframe[title="课件页面：把天气变成一个条件"]'));
    await demo.locator("iframe").evaluate(frame => {
      const stage = frame.closest<HTMLElement>(".product-scroll-stage")!;
      const panel = stage.querySelector<HTMLElement>(".product-scroll-panel")!;
      window.scrollTo({ top: window.scrollY + stage.getBoundingClientRect().top - parseFloat(getComputedStyle(panel).top) + (stage.clientHeight - panel.offsetHeight) * .8, behavior: "instant" });
    });
    const slide = demo.frameLocator("iframe").locator('iframe[title="课件页面：在生活中找到另一个条件"]');
    await slide.waitFor({ state: 'visible' });
    if (reducedMotion === "no-preference") {
      await page.waitForFunction(() => {
        const client = document.querySelector<HTMLIFrameElement>("#classroom iframe")?.contentDocument;
        const slide = client?.querySelector<HTMLIFrameElement>('iframe[title="课件页面：在生活中找到另一个条件"]');
        const opacity = slide ? Number(client!.defaultView!.getComputedStyle(slide).opacity) : 1;
        return opacity > 0 && opacity < 1;
      }, undefined, { timeout: 5000 });
      await slide.evaluate(frame => frame.getAnimations().forEach(animation => animation.finish()));
    }
    await expect(slide).toHaveCSS("opacity", "1");
    await expect(slide).toBeVisible();
    if (reducedMotion === "reduce") await expect(demo.locator("iframe")).toHaveCSS("opacity", "1");
  });
}

test("opening finishes automatically and supports pointer and keyboard dismissal", async ({ page }) => {
  await freezeOpeningClock(page);
  await openWebsite(page);
  await expect(page.locator(".opening-scene")).toBeVisible();
  await page.clock.runFor(2800);
  await page.getByRole('button', { name: '跳过开屏' }).click();
  await expect(page.locator('.opening-scene')).toHaveCount(0);
  await page.clock.runFor(4200);
  await expect(page.locator(".opening-scene")).toHaveCount(0);
  await reloadWebsite(page);
  await expect(page.locator('.opening-scene')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳到主要内容' })).toBeFocused();
  await expect(page.locator('.opening-scene')).toHaveCount(0);
  await reloadWebsite(page);
  await expect(page.locator('.opening-scene')).toBeVisible();
  await dismissOpening(page);
  await reloadWebsite(page);
  await expect(page.locator('.opening-scene')).toBeVisible();
  await page.clock.runFor(4200);
  await expect(page.locator(".opening-scene")).toHaveCount(0);
  await page.clock.resume();
  await page.locator(".site-nav").getByRole("link", { name: "认识知芽", exact: true }).click();
  await expect(page.locator("#start")).toBeInViewport();
});

test("reduced motion bypasses opening and retains content and tab navigation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openWebsite(page);
  await expect(page.locator(".opening-scene")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "知芽" })).toBeVisible();
  const demo = page.getByRole('region', { name: '交互课堂演示' });
  await demo.getByRole('button', { name: '语音对话', exact: true }).click();
  const content = demo.frameLocator('iframe').frameLocator('iframe[title="课件页面：说出来，也随时插一句"]').getByText(/不采集麦克风/);
  await waitForPreview(demo, content);
  await expect(content).toBeVisible();
});

test("scroll parallax moves layers and stops when reduced motion is enabled", async ({ page }) => {
  await page.clock.install();
  await openWebsite(page);
  await page.clock.fastForward(4200);
  await dismissOpening(page);
  const notes = page.locator(".hero-content");
  const before = await notes.evaluate(el => getComputedStyle(el).translate);
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
  await expect.poll(() => notes.evaluate(el => getComputedStyle(el).translate)).not.toBe(before);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(notes).toHaveCSS("translate", "none");
  await expect(page.locator(".hero-content")).toHaveCSS("translate", "none");
});

test("decorative conveyors can be paused and resumed together", async ({ page }) => {
  await openWebsite(page);
  await dismissOpening(page);
  await page.getByRole("button", { name: "暂停装饰滚动" }).click();
  for (const track of await page.locator(".notes-track, .ribbon-track").all()) {
    await expect(track).toHaveCSS("animation-play-state", "paused");
  }
  await page.getByRole("button", { name: "继续装饰滚动" }).click();
  await page.mouse.move(700, 400);
  await page.getByRole("button", { name: "暂停装饰滚动" }).blur();
  await expect(page.locator(".ribbon-track")).toHaveCSS("animation-play-state", "running");
  const notes = page.locator('.notes-track').first();
  await expect(notes).toHaveCSS('animation-play-state', 'running');
  const positions = await notes.evaluate(element => {
    const animation = element.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
    const start = getComputedStyle(element).transform;
    animation.currentTime = 1000;
    return { start, advanced: getComputedStyle(element).transform };
  });
  expect(positions.advanced).not.toBe(positions.start);
});
