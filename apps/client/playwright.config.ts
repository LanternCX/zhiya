import { defineConfig } from "@playwright/test";
import { loadClientConfig } from "../../scripts/config.mjs";

const { config } = loadClientConfig();
const developmentURL = new URL(config.dev_origin);
developmentURL.port = String(Number(developmentURL.port || 80) + 1);
// These tests import source modules or exercise Vite's private-file protection.
const developmentTests = [
  "**/voice-mode.spec.ts",
  "**/conversation-sync.spec.ts",
  "**/rate-limit.spec.ts",
  "**/config.spec.ts",
];

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 2,
  fullyParallel: true,
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 10_000 : 5_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    { name: "chromium", testIgnore: developmentTests },
    {
      name: "development",
      testMatch: developmentTests,
      use: { baseURL: developmentURL.origin },
    },
  ],
  use: {
    baseURL: config.dev_origin,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run build && npm run preview",
      url: config.dev_origin,
      reuseExistingServer: false,
    },
    {
      command: "npm run dev",
      env: { ZHIYA_CLIENT_DEV_ORIGIN: developmentURL.origin },
      url: developmentURL.origin,
      reuseExistingServer: false,
    },
    {
      command: "node ../../scripts/run.mjs server",
      env: {
        ZHIYA_SERVER_MODEL_ENDPOINT:
          "http://127.0.0.1:18083/v1/chat/completions",
        ZHIYA_SERVER_MODEL_ID: "gpt-5.6-luna",
        ZHIYA_SERVER_MODEL_API_KEY: "test-only",
      },
      url: config.api_origin + "/health",
      reuseExistingServer: false,
    },
  ],
});
