import { test as base, expect, type Locator, type Page } from '@playwright/test';

export { expect, type Page };

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    if (process.env.ZHIYA_WEBSITE_STRESS === '1') {
      const session = await page.context().newCDPSession(page);
      await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const origin = new URL(baseURL!).origin;
      await page.route('**/*', async route => {
        if (new URL(route.request().url()).origin === origin) {
          // Inject resource latency, rather than sleeping to assume the UI is ready.
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        await route.fallback();
      });
    }
    await use(page);
  },
});

async function waitForWebsite(page: Page) {
  await page.getByRole('link', { name: '知芽首页', exact: true }).waitFor({ state: 'visible' });
  await page.locator('html[data-theme]').waitFor({ state: 'attached' });
}

export async function openWebsite(page: Page) {
  await page.goto('./');
  await waitForWebsite(page);
}

export async function reloadWebsite(page: Page) {
  await page.reload();
  await waitForWebsite(page);
}

export async function dismissOpening(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('.opening-scene')).toHaveCount(0);
}

/** Keep expiring opening controls available until the test advances their clock. */
export async function freezeOpeningClock(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const opening = document.querySelector('.opening-scene');
      opening?.getAnimations({ subtree: true }).forEach(animation => {
        if (animation.playState !== 'paused') animation.pause();
      });
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

export async function waitForPreview(demo: Locator, content: Locator) {
  await demo.locator('.product-embed-viewport[aria-busy="false"]').waitFor({ state: 'attached' });
  await content.waitFor({ state: 'visible' });
}

/** Hold real browser transitions at their midpoint so sampling cannot miss them. */
export async function pausePreviewTransitions(page: Page) {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this instanceof HTMLIFrameElement) {
        const duration = animation.effect?.getTiming().duration;
        if (typeof duration === 'number' && duration > 0) {
          animation.pause();
          animation.currentTime = duration / 2;
        }
      }
      return animation;
    };
  });
}
