import {ensureBrowser} from '@remotion/renderer';
import {chromium} from '../../../node_modules/playwright-core/index.mjs';

export async function launchBrowser() {
  const browser = await ensureBrowser();
  if (!('path' in browser)) throw new Error('Remotion browser is unavailable');
  return chromium.launch({executablePath: browser.path, headless: true});
}
