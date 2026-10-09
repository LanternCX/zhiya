import { expect, test } from '@playwright/test';

test('original teacher workspace edits classroom and document together and downloads HTML', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  const demo = page.getByRole('region', { name: '备课与内容产物演示' });
  const client = demo.frameLocator('iframe');
  await client.getByRole('textbox', { name: '告诉知芽你想学什么' }).fill('把这个例子改成穿衣活动');
  await client.getByRole('button', { name: '发送', exact: true }).click();
  await expect(client.getByText('已把示例改成穿衣活动，课堂和文档已同步更新。')).toBeVisible();
  await client.getByRole('button', { name: '文档', exact: true }).click();
  await expect(client.getByRole('region', { name: '文档预览' })).toContainText('温度低 → 加一件外套');
  await client.getByRole('button', { name: '导出与分享', exact: true }).click();
  const download = page.waitForEvent('download');
  await client.getByRole('menuitem', { name: '下载 HTML 单文件' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.html$/);
});

test('original sharing dialog supports public and multiple class permissions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  const client = page.getByRole('region', { name: '备课与内容产物演示' }).frameLocator('iframe');
  await client.getByRole('button', { name: '导出与分享', exact: true }).click();
  await client.getByRole('menuitem', { name: '分享设置' }).click();
  await client.getByRole('radio', { name: /获得链接的任何人可见/ }).click();
  await expect(client.getByText('已开放分享，可复制链接。')).toBeVisible();
  await client.getByRole('radio', { name: /分享到班级/ }).click();
  await client.getByRole('checkbox', { name: '五年级 · AI 探索' }).check();
  await client.getByRole('checkbox', { name: '编程探索班' }).check();
  await client.getByRole('button', { name: '保存班级分享' }).click();
  await expect(client.getByText('已分享给所选班级，成员登录后可查看。')).toBeVisible();
});

test('original class management and teacher materials are available in the embedded client', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  const demo = page.getByRole('region', { name: '班级与内容分享演示' });
  await demo.locator('.product-embed-toolbar').scrollIntoViewIfNeeded();
  const client = demo.frameLocator('iframe');
  await client.getByRole('link', { name: '管理班级' }).click();
  await client.getByRole('textbox', { name: '班级名称', exact: true }).fill('五年级 · 编程探索');
  await client.getByRole('button', { name: '保存名称' }).click();
  await expect(client.getByText('班级名称已保存')).toBeVisible();
  await client.getByRole('link', { name: '返回班级面板' }).click();
  await expect(client.getByRole('heading', { name: '五年级 · 编程探索', exact: true })).toBeVisible();
  await client.getByRole('link', { name: /教师分享/ }).click();
  await expect(client.getByRole('heading', { name: '条件判断 · 教案与学习材料' })).toBeVisible();
});

test('hero controls lead to the embedded classroom and download sections', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await page.locator('.hero').getByRole('link', { name: '体验课堂', exact: true }).click();
  await expect(page.getByRole('region', { name: '交互课堂演示' })).toBeInViewport();
  await page.getByRole('link', { name: '下载知芽', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '把知芽，带到你的桌面。' })).toBeInViewport();
});

test('late classroom loading preserves the download destination', async ({ page }) => {
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/product-demo/index.html?scene=materials&role=student', async route => {
    requested();
    await gate;
    await route.continue();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await page.locator('.hero').getByRole('link', { name: '体验课堂', exact: true }).click();
  await started;
  await page.getByRole('link', { name: '下载知芽', exact: true }).first().click();
  const destination = page.getByRole('heading', { name: '把知芽，带到你的桌面。' });
  await expect(destination).toBeInViewport();
  release();
  const demo = page.getByRole('region', { name: '交互课堂演示' });
  await demo.frameLocator('iframe').getByRole('textbox', { name: '告诉知芽你想学什么' }).waitFor({ state: 'visible' });
  await expect(destination).toBeInViewport();
});

test('late profile loading preserves the classroom destination', async ({ page }) => {
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/product-demo/index.html?scene=profile&role=student', async route => {
    requested();
    await gate;
    await route.continue();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await page.locator('.hero').getByRole('link', { name: '体验课堂', exact: true }).click();
  await started;
  const classroom = page.getByRole('region', { name: '交互课堂演示' });
  await expect(classroom).toBeInViewport();
  release();
  const profile = page.getByRole('region', { name: '建档与学习记忆演示' });
  await profile.frameLocator('iframe').getByRole('heading', { name: '学习档案', exact: true }).waitFor({ state: 'visible' });
  await expect(classroom).toBeInViewport();
});
