import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 8790);
const freshPort = Number(process.env.E2E_FRESH_PORT ?? 8791);
// Lets environments that can't download Playwright's browsers use an installed Chromium.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "e2e",
  testIgnore: "acceptance/**",
  // Tests share one server and some edit its config, so run them one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 960 },
        launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
      },
    },
    {
      name: "firefox",
      // The first-run server can be set up once, so the wizard runs in Chromium only.
      testIgnore: ["acceptance/**", "wizard.spec.ts"],
      use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 960 } },
    },
    {
      name: "webkit",
      testIgnore: ["acceptance/**", "wizard.spec.ts"],
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 960 } },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @slate/display build && tsx e2e/server.ts",
      url: `http://127.0.0.1:${port}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "tsx e2e/server.ts",
      env: { E2E_FRESH: "1", E2E_PORT: String(freshPort) },
      url: `http://127.0.0.1:${freshPort}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
