import { mkdirSync } from "node:fs";
import { test } from "@playwright/test";
import { completeWizard, expectWorkingScreen } from "../wizard-flow.ts";

// Phase 1b acceptance: an installed server (install.sh, install.ps1, or Docker) plus the
// wizard reaches a working screen with live weather, no API keys, and no file edits.
const shots = process.env.SCREENSHOT_DIR;

test("one command plus the wizard reaches a working screen", async ({ page }) => {
  if (shots) mkdirSync(shots, { recursive: true });
  const path = await completeWizard(page, {
    password: "acceptance password",
    code: process.env.ACCEPTANCE_CODE || undefined,
    search: { query: "Portland", pick: /Portland, Oregon/ },
    screenshot: shots
      ? (step) =>
          page.screenshot({ path: `${shots}/${step}.png`, fullPage: true }).then(() => undefined)
      : undefined,
  });
  await expectWorkingScreen(page, path, "Portland");
  if (shots) await page.screenshot({ path: `${shots}/6-display.png` });
});
