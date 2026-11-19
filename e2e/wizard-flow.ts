import { expect, type Page } from "@playwright/test";

export interface WizardOptions {
  password: string;
  /** Setup code, for servers that see the browser as a LAN client. */
  code?: string;
  /** Search text and the result to pick; omit to enter coordinates instead. */
  search?: { query: string; pick: RegExp };
  coords?: { lat: number; lon: number; name: string; timezone: string };
  starter?: string;
  /** Saves a screenshot per step as `<prefix>-<step>.png`. */
  screenshot?: (step: string) => Promise<void>;
}

/** Drives the first-run wizard to the end and returns the display path it shows. */
export async function completeWizard(page: Page, opts: WizardOptions): Promise<string> {
  const shot = opts.screenshot ?? (async () => undefined);
  await page.goto(`/setup${opts.code ? `?code=${opts.code}` : ""}`);

  await expect(page.locator("#step-admin")).toBeVisible();
  await page.fill("#admin-pw", opts.password);
  await page.fill("#admin-pw2", opts.password);
  await shot("1-admin");
  await page.click("#admin-go");

  await expect(page.locator("#step-location")).toBeVisible();
  if (opts.search) {
    await page.fill("#loc-q", opts.search.query);
    const result = page.locator("#loc-results button", { hasText: opts.search.pick }).first();
    await expect(result).toBeVisible({ timeout: 15_000 });
    await shot("2-location");
    await result.click();
    await expect(page.locator("#loc-picked")).toContainText("Selected");
  } else if (opts.coords) {
    await page.locator("#loc-manual summary").click();
    await page.fill("#loc-lat", String(opts.coords.lat));
    await page.fill("#loc-lon", String(opts.coords.lon));
    await page.fill("#loc-name", opts.coords.name);
    await page.fill("#loc-tz", opts.coords.timezone);
    await shot("2-location");
  }
  await page.click("#loc-go");

  await expect(page.locator("#step-units")).toBeVisible();
  await page.selectOption("#u-temp", "fahrenheit");
  await expect(page.locator("#n-enabled")).not.toBeChecked();
  await shot("3-units");
  await page.click("#units-go");

  await expect(page.locator("#step-starter")).toBeVisible();
  await page.locator(`input[name=starter][value="${opts.starter ?? "clock-weather"}"]`).check();
  await shot("4-starter");
  await page.click("#starter-go");

  await expect(page.locator("#step-display")).toBeVisible();
  const display = page.locator("#display-list .display").first();
  await expect(display.locator("img.qr")).toHaveJSProperty("complete", true);
  expect(
    await display.locator("img.qr").evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await display.locator("details summary").click();
  await expect(display.locator("details pre").first()).toContainText("setup-kiosk.ps1");
  await shot("5-display");
  const path = await display.locator("a.open-here").getAttribute("href");
  expect(path).toMatch(/^\/d\//);

  await page.click("#finish");
  await expect(page).toHaveURL(/\/$/);
  return path!;
}

/** The display shows the clock-weather starter with live data and no error text. */
export async function expectWorkingScreen(page: Page, path: string, location: string | RegExp) {
  await page.goto(path);
  const clock = page.frameLocator('.cell[data-instance="clock"] iframe');
  const weather = page.frameLocator('.cell[data-instance="weather"] iframe');
  await expect(clock.locator("[data-clock-time]")).toHaveText(/^\d{1,2}:\d{2}/);
  await expect(weather.locator(".title_bar .title")).toHaveText(location);
  try {
    await expect(weather.getByText(/-?\d+°F/).first()).toBeVisible({ timeout: 30_000 });
  } catch (err) {
    const health = await page.request.get("/api/health").then((r) => r.text(), String);
    throw new Error(`No temperature on screen. Server connector health: ${health}`, {
      cause: err,
    });
  }
  await expect(page.locator("body")).not.toHaveAttribute("data-night", "true");
}
