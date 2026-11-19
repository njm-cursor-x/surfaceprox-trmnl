import { defineConfig, devices } from "@playwright/test";

// Runs e2e/acceptance against an already-installed server at ACCEPTANCE_URL.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "e2e/acceptance",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.ACCEPTANCE_URL ?? "http://127.0.0.1:8787",
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
});
