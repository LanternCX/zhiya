import { expect, test } from '@playwright/test';

const tag = 'v1.2.3';
const prefix = `https://github.com/LanternCX/zhiya/releases/download/${tag}/`;
const downloads = [
  { id: 'windows-x64', label: 'Windows · 64 位', name: 'Zhiya_1.2.3_windows_x64_setup.exe' },
  { id: 'macos-arm64', label: 'macOS · Apple Silicon', name: 'Zhiya_1.2.3_macos_arm64.dmg' },
].map(item => ({ ...item, size: 1024, sha256: 'a'.repeat(64), url: prefix + item.name }));
const manifest = { schemaVersion: 1, tag, version: '1.2.3', signing: 'untrusted', downloads,
  releaseUrl: `https://github.com/LanternCX/zhiya/releases/tag/${tag}`, checksumsUrl: prefix + 'SHA256SUMS.txt' };

test('the download section explains availability when no complete release exists', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/downloads.json', route => route.fulfill({ json: { schemaVersion: 1, version: null, downloads: [] } }));
  await page.goto('./');
  await page.getByRole('link', { name: '下载知芽', exact: true }).first().click();
  const section = page.getByRole('region', { name: '把知芽，带到你的桌面。' });
  await expect(section.getByText('安装包准备中')).toBeVisible();
  await expect(section.getByRole('link', { name: /下载 Windows|下载 macOS/ })).toHaveCount(0);
});

test('a complete static manifest exposes Windows and Apple Silicon installers and installation instructions', async ({ page }) => {
  await page.route('**/downloads.json', route => route.fulfill({ json: manifest }));
  await page.goto('./');
  const section = page.getByRole('region', { name: '把知芽，带到你的桌面。' });
  await expect(section.getByText('版本 1.2.3')).toBeVisible();
  await expect(section.getByRole('article')).toHaveCount(2);
  await expect(section.getByText(/Intel/)).toHaveCount(0);
  for (const item of downloads) {
    await expect(section.getByRole('link', { name: `下载 ${item.label}` })).toHaveAttribute('href', item.url);
  }
  await expect(section.getByRole('link', { name: 'SHA-256 校验文件' })).toHaveAttribute('href', manifest.checksumsUrl);
  await section.getByText('macOS 首次打开', { exact: true }).click();
  await expect(section.getByText('xattr -dr com.apple.quarantine "/Applications/Zhiya.app"', { exact: true })).toBeVisible();
});

test('an incomplete or unavailable manifest keeps broken downloads off the page', async ({ page }) => {
  await page.route('**/downloads.json', route => route.fulfill({ json: { ...manifest, downloads: downloads.slice(0, 1) } }));
  await page.goto('./');
  await expect(page.getByText('安装包准备中')).toBeVisible();
  await expect(page.getByRole('link', { name: '下载 Windows · 64 位' })).toHaveCount(0);
  await page.unroute('**/downloads.json');
  await page.route('**/downloads.json', route => route.abort());
  await page.reload();
  await expect(page.getByText('安装包准备中')).toBeVisible();
});
