import { expect, test } from '@playwright/test';

test('the website covers current capabilities using the actual product interface', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  for (const title of ['先认识你，再一起往前走。', '把一节课，讲成看得见的理解。', '从备课，到一份拿得走的材料。', '让好内容，在班级里流动。']) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  const demo = page.getByRole('region', { name: '交互课堂演示' });
  for (const name of ['课程与材料', '图文课件', '动画演示', '插图与绘本', '视频教学', '随堂练习', '编程实践', '语音对话', '继续学习']) {
    await expect(demo.getByRole('button', { name, exact: true })).toBeVisible();
  }
  for (const label of ['建档与学习记忆演示', '交互课堂演示', '备课与内容产物演示', '班级与内容分享演示']) {
    await expect(page.getByRole('region', { name: label }).locator('iframe')).toHaveAttribute('src', /product-demo\/index.html/);
  }
});

test('all classroom scenes fit a phone and the original mobile interface remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  const demo = page.getByRole('region', { name: '交互课堂演示' });
  for (const name of ['课程与材料', '图文课件', '动画演示', '插图与绘本', '视频教学', '随堂练习', '编程实践', '语音对话', '继续学习']) {
    await demo.getByRole('button', { name, exact: true }).click();
    await expect(demo.frameLocator('iframe').getByRole('textbox', { name: '告诉知芽你想学什么' })).toBeVisible();
    const sizes = await demo.locator('iframe').evaluate(element => {
      const document = (element as HTMLIFrameElement).contentDocument!;
      return { width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth };
    });
    expect(sizes.scroll, name).toBeLessThanOrEqual(sizes.width);
  }
});

test('original classroom citations and code editor operate locally and reset cleanly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  const demo = page.getByRole('region', { name: '交互课堂演示' });
  const client = demo.frameLocator('iframe');
  await client.getByRole('button', { name: '查看引用：编程入门教材' }).click();
  await expect(client.getByText('条件判断根据条件的真假，选择执行不同的语句。', { exact: true })).toBeVisible();
  await demo.getByRole('button', { name: '编程实践', exact: true }).click();
  await client.getByRole('textbox', { name: '代码', exact: true }).fill('print("我会编程啦")');
  await client.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(client.getByRole('region', { name: '运行结果' })).toContainText('我会编程啦');
  await demo.getByRole('button', { name: '重置演示' }).click();
  await expect(client.getByRole('textbox', { name: '代码', exact: true })).toHaveText('print("你好，知芽！")');
});
