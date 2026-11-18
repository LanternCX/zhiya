import { expect, test } from '@playwright/test';

for (const [width, height] of [[850, 850], [460, 600]]) {
  test(`turtle result is not clipped in a ${width}x${height} classroom`, async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(async ({ width, height }) => {
      const reactURL = '/node_modules/.vite/deps/react.js';
      const rootURL = '/node_modules/.vite/deps/react-dom_client.js';
      const componentURL = '/src/features/course/CodingPage.tsx';
      const cssURL = '/src/features/course/course.css';
      const R = await import(/* @vite-ignore */ reactURL);
      const React = R.default || R;
      const D = await import(/* @vite-ignore */ rootURL);
      const { createRoot } = D.default || D;
      const { default: CodingPage } = await import(/* @vite-ignore */ componentURL);
      await import(/* @vite-ignore */ cssURL);
      document.body.innerHTML = `<main id="drawing-test" class="slide-stage" style="width:${width}px;height:${height}px;max-width:100vw;margin:0 auto"></main>`;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect x="100" y="100" width="120" height="120" fill="none" stroke="black"/></svg>';
      const exercise = {
        kind: 'coding', id: 'drawing', title: '正方形', instructions: '运行绘图',
        languageId: 1, languageName: 'Python', code: 'import turtle\n' + '# tree drawing\n'.repeat(90), stdin: '', status: 'active',
      };
      const root = createRoot(document.getElementById('drawing-test'));
      const renderExercise = (running: boolean) => root.render(
        React.createElement(React.Fragment, null,
          React.createElement(CodingPage, {
            exercise, running, onChange: () => {}, onEnd: async () => {},
            onRun: async () => {
              renderExercise(true);
              try {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return { stdout: '', stderr: '', message: '', compileOutput: '', time: '0.01', memory: 0,
                  status: { description: 'Completed' }, graphics: [{ mimeType: 'image/svg+xml', data: btoa(svg) }] };
              } finally { renderExercise(false); }
            },
          }),
          React.createElement('footer', { className: 'slide-controls' }, '1 / 1'),
        ),
      );
      renderExercise(false);
    }, { width, height });
    await page.getByRole('button', { name: '运行代码', exact: true }).click();
    const image = page.getByAltText('Python turtle 运行生成的图形');
    await expect(image).toBeAttached();
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    const outputPosition = () => page.locator('.coding-output').evaluate((node) =>
      node.getBoundingClientRect().top - node.closest('.coding-page')!.getBoundingClientRect().top);
    await expect.poll(outputPosition).toBeGreaterThanOrEqual(0);
    await expect.poll(outputPosition).toBeLessThanOrEqual(20);
    // Rerunning removes the old drawing before producing the replacement.
    await page.getByRole('button', { name: '运行代码', exact: true }).click();
    await expect(page.getByText('绘图完成，结果如下', { exact: true })).toBeVisible();
    await expect.poll(outputPosition).toBeGreaterThanOrEqual(0);
    await expect.poll(outputPosition).toBeLessThanOrEqual(20);
    const bounds = await image.evaluate((node) => {
      const output = node.closest('.coding-output')!;
      return { imageBottom: node.getBoundingClientRect().bottom, outputBottom: output.getBoundingClientRect().bottom, hiddenHeight: output.scrollHeight - output.clientHeight };
    });
    expect(bounds.imageBottom).toBeLessThanOrEqual(bounds.outputBottom);
    expect(bounds.hiddenHeight).toBeLessThanOrEqual(1);
    const rows = await page.locator('.coding-page').evaluate((node) => {
      const output = node.querySelector('.coding-output')!.getBoundingClientRect();
      const input = node.querySelector('label')!.getBoundingClientRect();
      const actions = node.querySelector('.coding-actions')!.getBoundingClientRect();
      return { outputBottom: output.bottom, inputTop: input.top, inputBottom: input.bottom, actionsTop: actions.top };
    });
    expect(rows.inputTop).toBeGreaterThanOrEqual(rows.outputBottom);
    expect(rows.actionsTop).toBeGreaterThanOrEqual(rows.inputBottom);
    await image.scrollIntoViewIfNeeded();
    await expect(image).toBeInViewport();
    await page.getByRole('button', { name: '运行代码', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: '运行代码', exact: true })).toBeInViewport();
  });
}
