// Playwright fixture servers: real plugins and a stubbed Open-Meteo so tests never touch
// the network. E2E_FRESH=1 starts a first-run server (no admin, starter config) for the
// wizard tests; otherwise a configured one with an admin password.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { parseConfig } from "@slate/core";
import { createSlate } from "../apps/server/src/server.ts";
import { E2E_PASSWORD } from "./constants.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../plugins/weather/test/fixtures/forecast.json", import.meta.url), "utf8"),
);

const E2E_PORT = Number(process.env.E2E_PORT ?? 8790);
const fresh = process.env.E2E_FRESH === "1";

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

const geocode = {
  results: [
    {
      name: "Testville",
      admin1: "Oregon",
      country: "United States",
      latitude: 45.5,
      longitude: -122.7,
      timezone: "America/Los_Angeles",
    },
  ],
};

const slate = await createSlate({
  dataDir: mkdtempSync(join(tmpdir(), "slate-e2e-")),
  initialConfig: fresh ? undefined : config,
  preferSource: true,
  tickMs: 500,
  pingMs: 2_000,
  fetch: async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    return Response.json(url.includes("geocoding-api") ? geocode : fixture);
  },
});
if (slate.loadErrors.length) throw new Error(JSON.stringify(slate.loadErrors));
if (!fresh) slate.auth.createAdmin(E2E_PASSWORD);
slate.runtime.start();
serve({ fetch: slate.app.fetch, port: E2E_PORT, hostname: "127.0.0.1" }, () => {
  console.log(`e2e server on http://127.0.0.1:${E2E_PORT}`);
});
