// Playwright fixture server: real plugins, deterministic config, and a stubbed
// Open-Meteo so display tests never touch the network.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { parseConfig } from "@slate/core";
import { createSlate } from "../apps/server/src/server.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../plugins/weather/test/fixtures/forecast.json", import.meta.url), "utf8"),
);

export const E2E_PORT = Number(process.env.E2E_PORT ?? 8790);

const config = parseConfig({
  location: { name: "Testville", lat: 10, lon: 20, timezone: "UTC" },
  units: { temperature: "fahrenheit", time: "24h" },
  instances: {
    clock: { widget: "clock", settings: { face: "digital" } },
    weather: { widget: "weather" },
    analog: { widget: "clock", settings: { face: "analog", seconds: "yes" } },
  },
  screens: {
    a: {
      grid: {
        cols: 12,
        rows: 8,
        items: [
          { instance: "clock", x: 0, y: 0, w: 6, h: 8 },
          { instance: "weather", x: 6, y: 0, w: 6, h: 8 },
        ],
      },
    },
    b: { grid: { cols: 12, rows: 8, items: [{ instance: "analog", x: 0, y: 0, w: 12, h: 8 }] } },
  },
  playlists: {
    rotate: {
      items: [
        { screen: "a", dwell: "3s" },
        { screen: "b", dwell: "3s" },
      ],
    },
    single: { items: [{ screen: "a", dwell: "1h" }] },
  },
  displays: {
    main: {
      token: "e2e-main-display-token",
      playlist: "single",
      timezone: "UTC",
      pixelShift: false,
      night: { enabled: false },
    },
    rotating: {
      token: "e2e-rotating-display-token",
      playlist: "rotate",
      timezone: "UTC",
      night: { enabled: false },
    },
    night: {
      token: "e2e-night-display-token",
      playlist: "single",
      timezone: "UTC",
      night: { enabled: true, from: "22:00", to: "07:00", dim: 0.5, theme: "ink-dark" },
    },
  },
});

const slate = await createSlate({
  dataDir: mkdtempSync(join(tmpdir(), "slate-e2e-")),
  initialConfig: config,
  preferSource: true,
  tickMs: 500,
  pingMs: 2_000,
  fetch: async () =>
    new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } }),
});
if (slate.loadErrors.length) throw new Error(JSON.stringify(slate.loadErrors));
slate.runtime.start();
serve({ fetch: slate.app.fetch, port: E2E_PORT, hostname: "127.0.0.1" }, () => {
  console.log(`e2e server on http://127.0.0.1:${E2E_PORT}`);
});
