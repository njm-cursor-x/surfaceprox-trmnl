import { expect, test, type Page } from "@playwright/test";

const MAIN = "/d/e2e-main-display-token";
const ROTATING = "/d/e2e-rotating-display-token";
const NIGHT = "/d/e2e-night-display-token";

const cell = (page: Page, instance: string) => page.locator(`.cell[data-instance="${instance}"]`);
const frame = (page: Page, instance: string) =>
  page.frameLocator(`.cell[data-instance="${instance}"] iframe`);

async function getConfig(page: Page) {
  const res = await page.request.get("/api/config");
  return res.json();
}

async function putConfig(page: Page, config: unknown) {
  const res = await page.request.put("/api/config", {
    data: config,
    headers: { "content-type": "application/json" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test("renders the screen grid with each widget in a sandboxed iframe", async ({ page }) => {
  await page.goto(MAIN);
  await expect(page.locator("body")).toHaveAttribute("data-screen", "a");
  await expect(page.locator(".cell iframe")).toHaveCount(2);
  for (const sandbox of await page
    .locator(".cell iframe")
    .evaluateAll((els) => els.map((e) => e.getAttribute("sandbox")))) {
    expect(sandbox).toBe("allow-scripts");
  }
  await expect(cell(page, "clock")).toHaveAttribute("data-layout", "half_vertical");

  const clock = await cell(page, "clock").boundingBox();
  const weather = await cell(page, "weather").boundingBox();
  expect(clock!.x).toBeLessThan(weather!.x);
  expect(Math.abs(clock!.width - weather!.width)).toBeLessThan(2);
});

test("clock ticks live inside its iframe without a connector", async ({ page }) => {
  await page.goto(MAIN);
  const time = frame(page, "clock").locator("[data-clock-time]");
  await expect(time).toHaveText(/^\d{1,2}:\d{2}$/);
});

test("weather renders connector data for the user-set location", async ({ page }) => {
  await page.goto(MAIN);
  const weather = frame(page, "weather");
  await expect(weather.locator(".title_bar .title")).toHaveText("Testville");
  await expect(weather.getByText("72°F")).toBeVisible();
  await expect(weather.getByText("Partly cloudy").first()).toBeVisible();
});

test("widget iframes are cross-origin to the display and cannot reach it", async ({ page }) => {
  await page.goto(MAIN);
  await expect(page.locator(".cell iframe")).toHaveCount(2);
  const child = page.frames().find((f) => f !== page.mainFrame())!;
  const result = await child.evaluate(() => {
    let parentReadable = true;
    try {
      void window.parent.document.title;
    } catch {
      parentReadable = false;
    }
    return { origin: window.origin, parentReadable };
  });
  expect(result).toEqual({ origin: "null", parentReadable: false });
});

test("playlist rotates between screens", async ({ page }) => {
  await page.goto(ROTATING);
  const body = page.locator("body");
  await expect(body).toHaveAttribute("data-screen", /^(a|b)$/);
  const first = await body.getAttribute("data-screen");
  const next = first === "a" ? "b" : "a";
  await expect(body).toHaveAttribute("data-screen", next, { timeout: 8_000 });
  if (next === "b") await expect(frame(page, "analog").locator("svg.face-analog")).toBeVisible();
});

test("config changes reach the display over SSE without a page reload", async ({ page }) => {
  await page.goto(MAIN);
  await expect(frame(page, "weather").locator(".title_bar .title")).toHaveText("Testville");
  await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 42));

  const original = await getConfig(page);
  try {
    await putConfig(page, {
      ...original,
      location: { ...original.location, name: "Updated City" },
    });
    await expect(frame(page, "weather").locator(".title_bar .title")).toHaveText("Updated City");
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(
      42,
    );
  } finally {
    await putConfig(page, original);
  }
});

test("night mode dims and switches to the dark theme on schedule", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-18T23:30:00Z"));
  await page.goto(NIGHT);
  await expect(page.locator("body")).toHaveAttribute("data-night", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ink-dark");
  await expect(page.locator("#dim")).toHaveCSS("opacity", "0.5");
  await expect(frame(page, "clock").locator("html")).toHaveAttribute("data-theme", "ink-dark");
});

test("night mode is off during the day", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-18T12:00:00Z"));
  await page.goto(NIGHT);
  await expect(page.locator("body")).toHaveAttribute("data-night", "false");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await expect(page.locator("#dim")).toHaveCSS("opacity", "0");
});

test("unknown display tokens get a clear 404", async ({ page }) => {
  const res = await page.goto("/d/not-a-real-token");
  expect(res?.status()).toBe(404);
});
