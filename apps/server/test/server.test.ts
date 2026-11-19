import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig, type SlateConfig } from "@slate/core";
import { loadPlugins } from "@slate/core/node";
import { describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { defaultDataDir } from "../src/paths.ts";
import { ConnectorRuntime } from "../src/runtime.ts";
import { createSlate } from "../src/server.ts";
import { starterConfig } from "../src/store.ts";

const plugins = fileURLToPath(new URL("../../../plugins", import.meta.url));
const forecast = JSON.parse(
  readFileSync(join(plugins, "weather/test/fixtures/forecast.json"), "utf8"),
);
const TOKEN = "test-display-token-123";

function config(overrides: Partial<Record<keyof SlateConfig, unknown>> = {}) {
  return parseConfig({
    location: { name: "Testville", lat: 10, lon: 20, timezone: "UTC" },
    instances: { clock: { widget: "clock" }, weather: { widget: "weather" } },
    screens: {
      home: {
        grid: {
          items: [
            { instance: "clock", x: 0, y: 0, w: 6, h: 8 },
            { instance: "weather", x: 6, y: 0, w: 6, h: 4 },
          ],
        },
      },
    },
    playlists: { default: { items: [{ screen: "home", dwell: "1m" }] } },
    displays: { main: { token: TOKEN, playlist: "default" } },
    ...overrides,
  });
}

const PASSWORD = "correct horse battery";

async function freshSlate(
  initial?: SlateConfig,
  fetchImpl = vi.fn(async () => Response.json(forecast)),
  address = "192.168.1.20",
) {
  const slate = await createSlate({
    dataDir: mkdtempSync(join(tmpdir(), "slate-test-")),
    pluginDirs: [plugins],
    displayDir: mkdtempSync(join(tmpdir(), "slate-display-")),
    initialConfig: initial,
    preferSource: true,
    fetch: fetchImpl,
    clientAddress: () => address,
  });
  const raw = (path: string, init?: RequestInit) => slate.app.request(path, init);
  return { ...slate, raw, fetchImpl };
}

const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;
const json = (body: unknown, extra: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", host: "192.168.1.5:8787", ...extra },
  body: JSON.stringify(body),
});

/** A server with an admin, and `req` that sends the admin's session cookie. */
async function setup(initial = config(), fetchImpl = vi.fn(async () => Response.json(forecast))) {
  const slate = await freshSlate(initial, fetchImpl);
  slate.auth.createAdmin(PASSWORD);
  const cookie = cookieOf(await slate.raw("/api/login", json({ password: PASSWORD })));
  const req = (path: string, init: RequestInit = {}) =>
    slate.raw(path, { ...init, headers: { ...(init.headers as object), cookie } });
  return { ...slate, req, cookie };
}

describe("starter config", () => {
  it("is keyless, has no location, and validates", async () => {
    const c = starterConfig();
    expect(c.location).toBeNull();
    expect(Object.values(c.instances).map((i) => i.widget)).toEqual(["clock", "weather"]);
    expect(c.displays.main!.token.length).toBeGreaterThanOrEqual(16);
    const { req } = await setup(c);
    const res = await req("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(c),
    });
    expect(res.status).toBe(200);
  });
});

describe("data dir", () => {
  it("uses per-platform defaults and honors SLATE_DATA_DIR", () => {
    expect(defaultDataDir({ ProgramData: "C:\\ProgramData" }, "win32")).toBe(
      join("C:\\ProgramData", "slate"),
    );
    expect(defaultDataDir({ XDG_DATA_HOME: "/xdg" }, "linux")).toBe(join("/xdg", "slate"));
    expect(defaultDataDir({}, "darwin")).toMatch(/Library[\\/]Application Support[\\/]slate$/);
    expect(defaultDataDir({ SLATE_DATA_DIR: "/data" }, "win32")).toMatch(/data$/);
  });
});

describe("display API", () => {
  it("renders each grid cell with the slot-matched TRMNL layout", async () => {
    const { req, runtime } = await setup();
    await runtime.tick();
    const state = await (await req(`/api/display/${TOKEN}/state`)).json();
    expect(state.display.token).toBeUndefined();
    const cells = state.screens.home.cells;
    expect(cells.map((c: { instance: string; layout: string }) => [c.instance, c.layout])).toEqual([
      ["clock", "half_vertical"],
      ["weather", "quadrant"],
    ]);
    const weather = cells[1].html as string;
    expect(weather).toContain("Content-Security-Policy");
    expect(weather).toContain("connect-src 'none'");
    expect(weather).toContain("base-uri 'none'");
    expect(weather).toContain("72°F");
    expect(weather).toContain("Testville");
    expect(cells[0].html).toContain("face-digital");
    expect(cells[0].html).toContain('data-tz="UTC"');
  });

  it("404s unknown tokens", async () => {
    const { req } = await setup();
    expect((await req("/api/display/nope/state")).status).toBe(404);
    expect((await req("/api/display/nope/events")).status).toBe(404);
    expect((await req("/d/nope")).status).toBe(404);
  });

  it("explains when the display client isn't built", async () => {
    const { req } = await setup();
    const res = await req(`/d/${TOKEN}`);
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/pnpm build/);
  });

  it("shows a set-location prompt instead of fetching when location is unset", async () => {
    const { req, runtime, fetchImpl } = await setup(config({ location: null }));
    await runtime.tick();
    expect(fetchImpl).not.toHaveBeenCalled();
    const state = await (await req(`/api/display/${TOKEN}/state`)).json();
    expect(state.screens.home.cells[1].html).toContain("Set your location");
  });
});

describe("config API", () => {
  it("round-trips JSON and YAML and persists to config.yml", async () => {
    const { req, store } = await setup();
    const yaml = await (await req("/api/config.yml")).text();
    expect(parseYaml(yaml).location.name).toBe("Testville");

    const next = { ...store.get(), units: { temperature: "celsius", time: "24h" } };
    const res = await req("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    expect(res.status).toBe(200);
    expect(parseYaml(readFileSync(store.file, "utf8")).units.temperature).toBe("celsius");

    const yamlRes = await req("/api/config.yml", {
      method: "PUT",
      headers: { "content-type": "text/yaml" },
      body: yaml.replace("Testville", "Elsewhere"),
    });
    expect(yamlRes.status).toBe(200);
    expect(store.get().location!.name).toBe("Elsewhere");
  });

  it("rejects schema errors, broken references, and invalid layouts", async () => {
    const { req, store } = await setup();
    const put = (body: unknown) =>
      req("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const bad = await put({ ...store.get(), location: { lat: 999, lon: 0 } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues[0].path).toBe("location.lat");

    const overlap = structuredClone(store.get());
    overlap.screens.home!.grid.items[1]!.x = 4;
    expect((await (await put(overlap)).json()).issues[0].message).toMatch(/overlaps/);

    const tooSmall = structuredClone(store.get());
    tooSmall.screens.home!.grid.items[1] = { instance: "weather", x: 6, y: 0, w: 1, h: 1 };
    expect((await (await put(tooSmall)).json()).issues[0].message).toMatch(/smaller than/);

    const unknown = {
      ...store.get(),
      instances: { ...store.get().instances, x: { widget: "nope", settings: {} } },
    };
    expect((await (await put(unknown)).json()).issues[0].message).toMatch(/Unknown widget/);
  });

  it("refuses writes without a JSON/YAML content type (blocks simple cross-site posts)", async () => {
    const { req, store } = await setup();
    const res = await req("/api/config", {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(store.get()),
    });
    expect(res.status).toBe(415);
    const yamlRes = await req("/api/config.yml", {
      method: "PUT",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    expect(yamlRes.status).toBe(415);
  });

  it("serves the LAN config UI and health", async () => {
    const { req } = await setup();
    expect(await (await req("/")).text()).toContain("Night mode");
    const health = await (await req("/api/health")).json();
    expect(health.plugins.map((p: { id: string }) => p.id).sort()).toEqual(["clock", "weather"]);
    expect(health.loadErrors).toEqual([]);
  });
});

describe("LAN guard", () => {
  it("rejects Host names a remote site could rebind (DNS rebinding)", async () => {
    const { req } = await setup();
    const get = (host: string) => req("/api/config", { headers: { host } });
    for (const ok of [
      "localhost:8787",
      "192.168.1.20:8787",
      "[::1]:8787",
      "surface",
      "slate.local",
    ])
      expect((await get(ok)).status, ok).toBe(200);
    for (const bad of ["evil.example.com", "rebind.attacker.net:8787", "192.168.1.20.nip.io"])
      expect((await get(bad)).status, bad).toBe(403);
  });

  it("allows extra hosts from allowedHosts", async () => {
    const slate = await createSlate({
      dataDir: mkdtempSync(join(tmpdir(), "slate-test-")),
      pluginDirs: [plugins],
      displayDir: mkdtempSync(join(tmpdir(), "slate-display-")),
      initialConfig: config(),
      preferSource: true,
      allowedHosts: ["slate.example.com"],
    });
    const res = await slate.app.request("/healthz", { headers: { host: "slate.example.com" } });
    expect(res.status).toBe(200);
  });

  it("rejects cross-origin and oversized writes", async () => {
    const { req, store } = await setup();
    const put = (headers: Record<string, string>, body = JSON.stringify(store.get())) =>
      req("/api/config", {
        method: "PUT",
        headers: { host: "192.168.1.20:8787", "content-type": "application/json", ...headers },
        body,
      });
    expect((await put({ origin: "http://evil.example.com" })).status).toBe(403);
    expect((await put({ origin: "null" })).status).toBe(403);
    expect((await put({ origin: "http://192.168.1.20:8787" })).status).toBe(200);
    expect((await put({}, "x".repeat(2 * 1024 * 1024))).status).toBe(413);
  });

  it("sets security headers and blocks framing of the config UI", async () => {
    const { req } = await setup();
    const ui = await req("/");
    expect(ui.headers.get("x-frame-options")).toBe("DENY");
    expect(ui.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    const api = await req("/api/health");
    expect(api.headers.get("x-content-type-options")).toBe("nosniff");
    expect(api.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("ConnectorRuntime", () => {
  it("shares one fetch between instances with the same resolved config", async () => {
    const { registry } = await loadPlugins([plugins], { preferSource: true });
    const fetchImpl = vi.fn(async () => Response.json(forecast));
    const c = config({
      instances: {
        a: { widget: "weather" },
        b: { widget: "weather" },
        c: { widget: "weather", settings: { lat: 1, lon: 2 } },
      },
    });
    const runtime = new ConnectorRuntime(registry, c, { fetch: fetchImpl });
    await runtime.tick();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(runtime.bindingsFor("a").weather!.key).toBe(runtime.bindingsFor("b").weather!.key);
    expect(runtime.bindingsFor("a").weather!.key).not.toBe(runtime.bindingsFor("c").weather!.key);
  });

  it("does not refetch fresh data and emits change only when data changes", async () => {
    const { registry } = await loadPlugins([plugins], { preferSource: true });
    let now = 0;
    const fetchImpl = vi.fn(async () => Response.json(forecast));
    const runtime = new ConnectorRuntime(registry, config(), { fetch: fetchImpl, now: () => now });
    const changes = vi.fn();
    runtime.on("change", changes);
    await runtime.tick();
    await runtime.tick();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledTimes(1);
    now = 16 * 60_000;
    await runtime.tick();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it("backs off after a 429 and keeps the last good data", async () => {
    const { registry } = await loadPlugins([plugins], { preferSource: true });
    let now = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json(forecast))
      .mockResolvedValue(new Response("busy", { status: 429, headers: { "retry-after": "3600" } }));
    const runtime = new ConnectorRuntime(registry, config(), { fetch: fetchImpl, now: () => now });
    await runtime.tick();
    now = 16 * 60_000;
    await runtime.tick();
    const b = runtime.bindingsFor("weather").weather!;
    expect(b.error).toBe("Open-Meteo is limiting requests. Retrying later.");
    expect(runtime.health()[0]!.detail).toMatch(/429/);
    expect((b.data as { now: { temp: number } }).now.temp).toBe(72);
    now += 10 * 60_000;
    await runtime.tick();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(runtime.health()[0]!.quota.perDay).toBe(2);
  });
});
