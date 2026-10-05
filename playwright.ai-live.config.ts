import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./live-e2e",
  timeout: 180000,
  expect: { timeout: 30000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/ai-live",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5291",
    viewport: { width: 1600, height: 1000 },
    actionTimeout: 15000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5291 --strictPort",
    url: "http://127.0.0.1:5291",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
