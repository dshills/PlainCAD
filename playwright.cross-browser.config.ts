import { defineConfig, devices } from "@playwright/test";

/** Production native workflow coverage on independent browser engines. */
export default defineConfig({
  testDir: "./cross-browser-e2e",
  timeout: 120000,
  expect: { timeout: 30000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/cross-browser",
  use: {
    baseURL: "http://127.0.0.1:5281",
    viewport: { width: 1366, height: 900 },
    storageState: { cookies: [], origins: [] },
    actionTimeout: 20000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 5281 --strictPort",
    url: "http://127.0.0.1:5281",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
