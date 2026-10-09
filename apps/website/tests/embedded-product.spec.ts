import { expect, test, openWebsite, waitForPreview } from './browser';

test('one scroll position advances original slides and can rewind them', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWebsite(page);
  const demo = page.getByRole('region', { name: '交互课堂演示' });
  await demo.getByRole('button', { name: '图文课件', exact: true }).click();
  const client = demo.frameLocator('iframe');
  await waitForPreview(demo, client.locator('iframe[title="课件页面：把天气变成一个条件"]'));
  const scrollTo = async (progress: number) => {
    await demo.locator('.product-scroll-stage').evaluate((stage, value) => {
      const panel = stage.querySelector<HTMLElement>('.product-scroll-panel')!;
      const top = parseFloat(getComputedStyle(panel).top);
      const distance = stage.clientHeight - panel.offsetHeight;
      window.scrollTo({ top: window.scrollY + stage.getBoundingClientRect().top - top + distance * value, behavior: 'instant' });
    }, progress);
  };
  await scrollTo(.8);
  await expect(client.locator('iframe[title="课件页面：在生活中找到另一个条件"]')).toBeVisible();
  await scrollTo(.1);
  await expect(client.locator('iframe[title="课件页面：把天气变成一个条件"]')).toBeVisible();
});

test('page scrolling reveals long embedded content before releasing the next section', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWebsite(page);
  const demo = page.getByRole('region', { name: '交互课堂演示' });
  await demo.scrollIntoViewIfNeeded();
  const client = demo.frameLocator('iframe');
  const conversation = client.locator('.course-thread');
  await waitForPreview(demo, conversation);
  await conversation.evaluate(element => {
    const filler = element.ownerDocument.createElement('div');
    filler.style.height = '2000px';
    element.append(filler);
    element.scrollTop = 0;
  });
  const frame = demo.locator('iframe').first();
  const stage = demo.locator('.product-scroll-stage');
  await expect(stage).toBeVisible();
  await page.evaluate(() => {
    const stage = document.querySelector('#classroom .product-scroll-stage')!;
    window.scrollTo({ top: window.scrollY + stage.getBoundingClientRect().top - 96, behavior: 'instant' });
  });
  const panel = demo.locator('.product-scroll-panel');
  await expect.poll(() => panel.evaluate(element =>
    element.getBoundingClientRect().top - parseFloat(getComputedStyle(element).top)
  )).toBeCloseTo(0, 0);
  const pinned = (await frame.boundingBox())!.y;
  const before = await conversation.evaluate(element => element.scrollTop);
  await conversation.hover({ position: { x: 80, y: 80 } });
  const outer = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 260);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(outer + 100);
  await expect.poll(() => conversation.evaluate(element => element.scrollTop)).toBeGreaterThan(before + 50);
  await expect.poll(async () => (await frame.boundingBox())!.y).toBeCloseTo(pinned, 0);
  await expect(conversation).toHaveCSS('scrollbar-width', 'none');
  await page.mouse.move(10, 450);
  const internal = await conversation.evaluate(element => element.scrollTop);
  await page.mouse.wheel(0, 260);
  await expect.poll(() => conversation.evaluate(element => element.scrollTop)).toBeGreaterThan(internal + 50);
  await page.evaluate(() => {
    const stage = document.querySelector('#classroom .product-scroll-stage')!;
    window.scrollTo({ top: window.scrollY + stage.getBoundingClientRect().bottom, behavior: 'instant' });
  });
  await expect(page.locator('#prepare')).toBeInViewport();
});

test('original learning profile accepts a local preference correction', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWebsite(page);
  const demo = page.getByRole('region', { name: '建档与学习记忆演示' });
  const client = demo.frameLocator('iframe');
  await waitForPreview(demo, client.getByRole('heading', { name: '学习档案', exact: true }));
  await client.getByRole('textbox', { name: '修改或忘记' }).fill('我想先自己尝试，再看讲解');
  await client.getByRole('button', { name: '提交修改' }).click();
  await expect(client.locator('.memory-document')).toContainText('本次说明：我想先自己尝试，再看讲解');
});

test('original illustration and video classrooms use local assets without external calls', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const external: string[] = [];
  page.on('request', request => {
    if (request.url().startsWith('https://') || request.url().includes('/api/')) external.push(request.url());
  });
  await openWebsite(page);
  const demo = page.getByRole('region', { name: '交互课堂演示' });
  const client = demo.frameLocator('iframe');
  await demo.getByRole('button', { name: '插图与绘本', exact: true }).click();
  await waitForPreview(demo, client.getByRole('img', { name: '小芽在花园中观察天气' }));
  await demo.getByRole('button', { name: '视频教学', exact: true }).click();
  const video = client.frameLocator('iframe[title="教程演示：条件判断 · 从生活到代码"]');
  await waitForPreview(demo, video.getByRole('button', { name: '播放教程' }));
  await expect(client.getByRole('link', { name: '在B站打开' })).toHaveCount(0);
  // Let frames load normally, then pause at a fixed future instant before playback.
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await video.getByRole('button', { name: '播放教程' }).click();
  await expect(video.getByRole('button', { name: '暂停教程' })).toBeVisible();
  await page.clock.runFor(1000);
  const progress = video.getByRole('slider', { name: '教程进度' });
  expect(Number(await progress.inputValue())).toBeGreaterThan(0);
  await video.getByRole('button', { name: '暂停教程' }).click();
  const paused = await progress.inputValue();
  await page.clock.runFor(1000);
  await expect(progress).toHaveValue(paused);
  await video.getByRole('slider', { name: '教程进度' }).fill('16');
  await expect(video.getByRole('heading', { name: '把选择写成代码' })).toBeVisible();
  await video.getByRole('button', { name: '播放教程' }).click();
  await page.clock.runFor(9000);
  await expect(progress).toHaveValue('24');
  await expect(video.getByRole('button', { name: '播放教程' })).toBeVisible();
  await video.getByRole('button', { name: '播放教程' }).click();
  await expect(progress).toHaveValue('0');
  await video.getByRole('button', { name: '暂停教程' }).click();
  expect(external).toEqual([]);
});

test('wheel scrolling over a paused nested tutorial advances the website', async ({ page }) => {
  await openWebsite(page);
  const demo = page.getByRole('region', { name: '交互课堂演示' });
  await demo.getByRole('button', { name: '视频教学', exact: true }).click();
  const video = demo.frameLocator('iframe').frameLocator('iframe[title="教程演示：条件判断 · 从生活到代码"]');
  await waitForPreview(demo, video.getByRole('button', { name: '播放教程' }));
  await video.getByRole('button', { name: '播放教程' }).hover();
  const outerScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 180);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(outerScroll + 80);
});

test('the website embeds the actual client workspace with local preset interactions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const calls: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/') || request.url().startsWith('https://')) calls.push(request.url());
  });
  await openWebsite(page);
  const demo = page.getByRole('region', { name: '交互课堂演示' });
  const client = demo.frameLocator('iframe');
  await waitForPreview(demo, client.getByRole('button', { name: '学习地图' }));
  await expect(client.getByRole('textbox', { name: '告诉知芽你想学什么' })).toBeVisible();
  await demo.getByRole('button', { name: '随堂练习', exact: true }).click();
  await client.getByLabel('带上雨伞', { exact: true }).check();
  await client.getByRole('button', { name: '提交答案' }).click();
  await expect(client.getByText(/答案已提交/).first()).toBeVisible();
  expect(calls).toEqual([]);
});
