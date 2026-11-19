import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { FRESH_PORT } from "./constants.ts";
import { completeWizard, expectWorkingScreen } from "./wizard-flow.ts";

// Runs against the first-run server (E2E_FRESH=1); its state carries across these tests.
test.describe.configure({ mode: "serial" });
test.use({ baseURL: `http://127.0.0.1:${FRESH_PORT}` });

const shots = process.env.SCREENSHOT_DIR;
const PASSWORD = "wizard e2e password";

test("a fresh install sends the config page to the wizard and locks the API", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  expect((await page.request.get("/api/config")).status()).toBe(401);
});

test("the wizard reaches a working screen with no API keys", async ({ page, browserName }) => {
  if (shots) mkdirSync(shots, { recursive: true });
  const path = await completeWizard(page, {
    password: PASSWORD,
    search: { query: "Testville", pick: /Testville, Oregon/ },
    screenshot:
      shots && browserName === "chromium"
        ? (step) =>
            page
              .screenshot({ path: `${shots}/wizard-${step}.png`, fullPage: true })
              .then(() => undefined)
        : undefined,
  });
  await expect(page.locator("#app")).toBeVisible();
  await expectWorkingScreen(page, path, "Testville");
  if (shots && browserName === "chromium")
    await page.screenshot({ path: `${shots}/display-after-wizard.png` });
});

test("after setup, the config page asks for the password", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/");
  await expect(page.locator("#login")).toBeVisible();
  expect((await page.request.get("/api/config")).status()).toBe(401);
  await page.fill("#login-pw", "not the password");
  await page.click("#login button[type=submit]");
  await expect(page.locator("#login-status")).toContainText(/wrong/i);
  await page.fill("#login-pw", PASSWORD);
  await page.click("#login button[type=submit]");
  await expect(page.locator("#app")).toBeVisible();
  await page.close();
});
