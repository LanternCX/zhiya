import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

test("the ambient background is bounded, animated, and static with reduced motion", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator("body")).toHaveCSS("background-image", "none");
  const background = page.locator("canvas.ambient-background");
  await expect(background).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const pixels = async () => createHash("sha256").update(
    await background.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
  ).digest("hex");
  const size = await background.evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width, height: canvas.height,
  }));
  expect(size.width).toBeLessThanOrEqual(960);
  expect(size.height).toBeLessThanOrEqual(960);
  const initial = await pixels();
  await page.clock.runFor(1000);
  expect(await pixels()).not.toBe(initial);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => {
    const before = await pixels();
    await page.clock.runFor(1000);
    return await pixels() === before;
  }).toBe(true);
  const still = await pixels();
  await page.mouse.move(100, 100);
  await page.clock.runFor(1000);
  expect(await pixels()).toBe(still);
  await page.locator("header button").click();
  await page.locator("header button").click();
  await expect.poll(pixels).not.toBe(still);
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await expect(page.getByRole("heading", { name: "注册账号" })).toBeVisible();
  await expect(background).toBeVisible();

  await page.emulateMedia({ reducedMotion: "no-preference" });
  const resumed = await pixels();
  await page.clock.runFor(1000);
  expect(await pixels()).not.toBe(resumed);
});

for (const lowPower of [false, true]) {
  test(`background limits frame updates and pauses while hidden (${lowPower ? "low power" : "normal"})`, async ({ page }) => {
    await page.addInitScript((lowPower) => {
      Object.defineProperty(navigator, "hardwareConcurrency", { value: lowPower ? 4 : 8 });
      Object.defineProperty(navigator, "deviceMemory", { value: 8 });
    }, lowPower);
    await page.clock.install();
    await page.goto("/");
    const background = page.locator("canvas.ambient-background");
    await expect(background).toBeVisible();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.clock.runFor(200);
    const pixels = async () => createHash("sha256").update(
      await background.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
    ).digest("hex");
    let previous = await pixels();
    let changes = 0;
    for (let frame = 0; frame < 300; frame++) {
      await page.clock.runFor(10);
      const current = await pixels();
      if (current !== previous) changes++;
      previous = current;
    }
    // Sample three seconds to check sustained cadence. Browser frame scheduling
    // can move one update across the sampling window's boundary.
    expect(changes).toBeGreaterThanOrEqual(60);
    expect(changes).toBeLessThanOrEqual((lowPower ? 24 : 30) * 3 + 1);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hidden = await pixels();
    await page.clock.runFor(2000);
    expect(await pixels()).toBe(hidden);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(1000);
    expect(await pixels()).not.toBe(hidden);
    await page.setViewportSize({ width: 3840, height: 2160 });
    await expect.poll(() => background.evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBe(960);
  });
}
