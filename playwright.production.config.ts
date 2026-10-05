import { fullWorkspaceStorageState } from "./e2e/workspaceStorage";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./production-e2e",
  timeout: 90000,
  expect: { timeout: 20000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5280",
    viewport: { width: 1600, height: 1000 },
    // Existing CAD acceptance flows exercise the full workspace; focused-workspace cases override this.
    storageState: fullWorkspaceStorageState("http://127.0.0.1:5280"),
    actionTimeout: 15000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "test-results/production",
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 5280 --strictPort",
    url: "http://127.0.0.1:5280",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
