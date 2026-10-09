import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: process.env.ZHIYA_WEBSITE_STRESS === '1' ? 60_000 : 30_000,
  use: {
    baseURL: "http://127.0.0.1:4174/",
    channel: process.platform === "win32" ? "msedge" : undefined,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run preview:test",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
});
