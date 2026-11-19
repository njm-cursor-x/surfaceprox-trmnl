import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyTemplate, LAYOUT_TEMPLATES, nightState } from "@slate/core";
import { describe, expect, it, vi } from "vitest";
import { AuthStore, LoginLimiter } from "../src/auth.ts";
import { runCli } from "../src/cli.ts";
import { loadDevRegistry, devConfig, renderPreview } from "../src/dev-preview.ts";
import { qrSvg, qrTerminal } from "../src/qr.ts";
import { ConnectorRuntime } from "../src/runtime.ts";
import { createSlate } from "../src/server.ts";
import { applyStarter, STARTERS } from "../src/starters.ts";
import { starterConfig } from "../src/store.ts";

const plugins = fileURLToPath(new URL("../../../plugins", import.meta.url));
const forecast = JSON.parse(
  readFileSync(join(plugins, "weather/test/fixtures/forecast.json"), "utf8"),
);
const PASSWORD = "correct horse battery";
const LAN = { host: "192.168.1.5:8787" };

async function fresh(
  address = "192.168.1.20",
  fetchImpl = vi.fn(async () => Response.json(forecast)),
) {
  const dataDir = mkdtempSync(join(tmpdir(), "slate-setup-"));
  const slate = await createSlate({
    dataDir,
    pluginDirs: [plugins],
    displayDir: mkdtempSync(join(tmpdir(), "slate-display-")),
    preferSource: true,
    fetch: fetchImpl,
    clientAddress: () => address,
  });
  let cookie = "";
  const req = async (path: string, init: RequestInit = {}) => {
    const res = await slate.app.request(path, {
      ...init,
      headers: { ...LAN, ...(cookie ? { cookie } : {}), ...(init.headers as object) },
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    return res;
  };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    req(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return { ...slate, dataDir, req, post, clearCookie: () => (cookie = "") };
}

describe("auth store", () => {
  it("hashes the password, keeps auth.json private, and drops the setup code once claimed", () => {
    const dir = mkdtempSync(join(tmpdir(), "slate-auth-"));
    const auth = new AuthStore(dir);
    expect(auth.setupCode).toMatch(/^[0-9A-F]{12}$/);
    expect(readFileSync(join(dir, "setup-code"), "utf8").trim()).toBe(auth.setupCode);
    expect(auth.checkSetupCode(auth.setupCode!.toLowerCase())).toBe(true);
    expect(auth.checkSetupCode("nope")).toBe(false);

    auth.createAdmin(PASSWORD);
    expect(existsSync(join(dir, "setup-code"))).toBe(false);
    expect(readFileSync(join(dir, "auth.json"), "utf8")).not.toContain(PASSWORD);
    if (process.platform !== "win32") expect(statSync(join(dir, "auth.json")).mode & 0o077).toBe(0);
    expect(auth.verifyPassword(PASSWORD)).toBe(true);
    expect(auth.verifyPassword("wrong password")).toBe(false);
    expect(() => auth.createAdmin("another one")).toThrow();
    expect(() => auth.setPassword("short")).toThrow(/at least 8/);

    expect(new AuthStore(dir).verifyPassword(PASSWORD)).toBe(true);
  });

  it("signs sessions, expires them, and revokes them on password change", () => {
    const auth = new AuthStore(mkdtempSync(join(tmpdir(), "slate-auth-")));
    auth.createAdmin(PASSWORD);
    const token = auth.issueSession(1_000);
    expect(auth.verifySession(token, 2_000)).toBe(true);
    expect(auth.verifySession(token, 1_000 + 31 * 24 * 3600 * 1000)).toBe(false);
    const [payload] = token.split(".");
    expect(auth.verifySession(`${payload}.forged`, 2_000)).toBe(false);
    const now = auth.issueSession();
    auth.setPassword("a brand new password");
    expect(auth.verifySession(now)).toBe(false);
  });

  it("rate-limits failures per client within a window", () => {
    const limiter = new LoginLimiter(3, 1_000);
    for (let i = 0; i < 3; i++) limiter.fail("a", 0);
    expect(limiter.blocked("a", 10)).toBe(true);
    expect(limiter.blocked("b", 10)).toBe(false);
    expect(limiter.blocked("a", 2_000)).toBe(false);
  });
});

describe("first-run setup", () => {
  it("locks the config API until an admin exists", async () => {
    const s = await fresh();
    expect((await s.req("/")).headers.get("location")).toBe("/setup");
    expect((await s.req("/setup")).status).toBe(200);
    const res = await s.req("/api/config");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Finish setup first");
    const session = await (await s.req("/api/session")).json();
    expect(session).toMatchObject({ authenticated: false, hasAdmin: false, needsCode: true });
  });

  it("asks LAN clients for the setup code and lets the local machine claim without one", async () => {
    const lan = await fresh("192.168.1.20");
    expect((await lan.post("/api/setup/admin", { password: PASSWORD })).status).toBe(403);
    expect((await lan.post("/api/setup/admin", { password: PASSWORD, code: "WRONG" })).status).toBe(
      403,
    );
    const ok = await lan.post("/api/setup/admin", { password: PASSWORD, code: lan.auth.setupCode });
    expect(ok.status).toBe(200);
    expect((await lan.req("/api/config")).status).toBe(200);
    expect((await lan.post("/api/setup/admin", { password: PASSWORD })).status).toBe(409);

    const local = await fresh("127.0.0.1");
    const localSession = await (
      await local.req("/api/session", { headers: { host: "localhost:8787" } })
    ).json();
    expect(localSession.needsCode).toBe(false);
    const claimed = await local.post(
      "/api/setup/admin",
      { password: PASSWORD },
      { host: "localhost:8787" },
    );
    expect(claimed.status).toBe(200);
  });

  it("treats a loopback peer with a foreign Host header (DNS rebinding) as remote", async () => {
    const s = await fresh("127.0.0.1");
    const res = await s.post(
      "/api/setup/admin",
      { password: PASSWORD },
      { host: "evil.example:8787" },
    );
    expect(res.status).toBe(403);
  });

  it("rejects short passwords, cross-origin writes, and form posts", async () => {
    const s = await fresh();
    const code = s.auth.setupCode;
    expect((await s.post("/api/setup/admin", { password: "short", code })).status).toBe(400);
    const cross = await s.post(
      "/api/setup/admin",
      { password: PASSWORD, code },
      { origin: "http://evil.example" },
    );
    expect(cross.status).toBe(403);
    const form = await s.req("/api/setup/admin", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ password: PASSWORD, code }),
    });
    expect(form.status).toBe(415);
    expect(s.auth.hasAdmin()).toBe(false);
  });

  it("signs in and out, and limits wrong passwords", async () => {
    const s = await fresh();
    s.auth.createAdmin(PASSWORD);
    expect((await s.post("/api/login", { password: "nope nope" })).status).toBe(401);
    expect((await s.post("/api/login", { password: PASSWORD })).status).toBe(200);
    expect((await s.req("/api/config")).status).toBe(200);
    await s.post("/api/logout", {});
    expect((await s.req("/api/config")).status).toBe(401);

    for (let i = 0; i < 10; i++) await s.post("/api/login", { password: "nope nope" });
    expect((await s.post("/api/login", { password: PASSWORD })).status).toBe(429);
  });

  it("changes the password and keeps the current session", async () => {
    const s = await fresh();
    s.auth.createAdmin(PASSWORD);
    await s.post("/api/login", { password: PASSWORD });
    const bad = await s.post("/api/password", { current: "wrong", next: "a new password" });
    expect(bad.status).toBe(403);
    expect(
      (await s.post("/api/password", { current: PASSWORD, next: "a new password" })).status,
    ).toBe(200);
    expect((await s.req("/api/config")).status).toBe(200);
    expect(s.auth.verifyPassword("a new password")).toBe(true);
  });

  it("walks the wizard: starter, location, display, QR, finish", async () => {
    const s = await fresh();
    await s.post("/api/setup/admin", { password: PASSWORD, code: s.auth.setupCode });

    const { starters, templates } = await (await s.req("/api/starters")).json();
    expect(starters.map((x: { id: string }) => x.id)).toEqual(STARTERS.map((x) => x.id));
    expect(templates.length).toBe(LAYOUT_TEMPLATES.length);

    const config = await (await s.req("/api/config")).json();
    const located = {
      ...config,
      location: { name: "Testville", lat: 10, lon: 20, timezone: "UTC" },
      units: { temperature: "fahrenheit", time: "12h" },
    };
    expect(
      (
        await s.req("/api/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(located),
        })
      ).status,
    ).toBe(200);

    const starter = await s.post("/api/setup/starter", { starter: "morning" });
    expect(starter.status).toBe(200);
    const after = (await starter.json()).config;
    expect(after.location.name).toBe("Testville");
    expect(after.units.temperature).toBe("fahrenheit");
    expect(after.screens.home.grid.items).toHaveLength(3);
    expect(after.displays.main.token).toBe(config.displays.main.token);
    expect((await s.post("/api/setup/starter", { starter: "nope" })).status).toBe(400);

    const added = await (await s.post("/api/displays", { name: "Kitchen" })).json();
    expect(added.id).toBe("display-2");
    expect(added.config.displays["display-2"]).toMatchObject({
      name: "Kitchen",
      playlist: "default",
    });
    expect(added.config.displays["display-2"].night.enabled).toBe(false);

    const qr = await s.req("/api/qr.svg?text=" + encodeURIComponent("http://192.168.1.5:8787/d/x"));
    expect(qr.headers.get("content-type")).toBe("image/svg+xml");
    expect(await qr.text()).toMatch(/^<svg[^>]*viewBox/);
    expect((await s.req("/api/qr.svg")).status).toBe(400);

    expect((await s.post("/api/setup/complete", {})).status).toBe(200);
    expect((await (await s.req("/api/session")).json()).setupComplete).toBe(true);

    await s.runtime.tick();
    const token = added.config.displays["display-2"].token;
    const state = await (await s.req(`/api/display/${token}/state`)).json();
    expect(Object.keys(state.screens.home.cells)).toHaveLength(3);
    expect(state.screens.home.cells[0].html).toContain("Testville");
  });

  it("serves displays without a session", async () => {
    const s = await fresh();
    const token = s.store.get().displays.main!.token;
    expect((await s.req(`/api/display/${token}/state`)).status).toBe(200);
  });
});

describe("starters and templates", () => {
  it("fills every template with non-overlapping items that cover the grid", () => {
    for (const t of LAYOUT_TEMPLATES) {
      const grid = applyTemplate(
        t,
        t.slots.map((_, i) => `i${i}`),
      );
      const area = grid.items.reduce((sum, it) => sum + it.w * it.h, 0);
      expect(area, t.id).toBe(grid.cols * grid.rows);
    }
  });

  it("has keyless starters that validate", () => {
    for (const s of STARTERS) {
      const config = applyStarter(starterConfig(), s.id);
      expect(config.screens.home!.grid.items).toHaveLength(s.instances.length);
    }
  });

  it("starts a fresh install with night mode off, even at night", () => {
    const display = starterConfig().displays.main!;
    expect(display.night.enabled).toBe(false);
    const night = nightState(display.night, display.theme, new Date("2026-01-01T02:00:00Z"), "UTC");
    expect(night.active).toBe(false);
  });
});

describe("TRMNL Framework widgets", () => {
  function recipe() {
    const root = mkdtempSync(join(tmpdir(), "slate-recipe-"));
    const dir = join(root, "hello");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "settings.yml"),
      "name: Hello\ncustom_fields:\n  - { keyname: who, field_type: string, default: <b>world</b> }\n",
    );
    writeFileSync(
      join(dir, "src", "full.liquid"),
      '<div class="layout"><span class="value">{{ settings.who }}</span></div><div class="title_bar"><span class="title">Hi</span></div>',
    );
    return { root, dir };
  }

  it("links the framework stylesheet, scales the view, and escapes output", async () => {
    const { root } = recipe();
    const { registry } = await loadDevRegistry(root);
    expect(registry.widgets.get("hello")!.framework).toBe("trmnl");
    const config = devConfig(registry, { dir: root });
    const runtime = new ConnectorRuntime(registry, config, { fetch: vi.fn() });
    const [widget] = await renderPreview(registry, config, runtime, {
      assetOrigin: "http://slate.local:8787",
    });
    const frame = widget!.frames.find((f) => f.device === "trmnl" && f.layout === "full")!;
    expect(frame.html).toContain('<html class="trmnl"');
    expect(frame.html).toContain(
      'href="http://slate.local:8787/framework/3.4.6/trmnl-framework.css"',
    );
    expect(frame.html).toContain("style-src 'unsafe-inline' http://slate.local:8787");
    expect(frame.html).toContain('<div class="view view--full">');
    expect(frame.html).toContain("--device-ui-scale:1");
    expect(frame.html).toContain("&lt;b&gt;world&lt;/b&gt;");
    expect(widget!.frames).toHaveLength(8);
  });

  it("serves the trimmed framework with the Slate adapter", async () => {
    const s = await fresh();
    const res = await s.req("/framework/3.4.6/trmnl-framework.css");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const css = await res.text();
    expect(css).toContain("TRMNL Framework 3.4.6");
    expect(css).toContain(".value");
    expect(css).toContain("var(--ink)");
    expect(css.length).toBeLessThan(400_000);
  });

  it("keeps Slate widgets on the Slate base styles", async () => {
    const { registry } = await loadDevRegistry(join(plugins, "clock"));
    expect(registry.widgets.get("clock")!.framework).toBe("slate");
  });
});

describe("cli and qr", () => {
  it("renders QR codes as SVG and terminal blocks", () => {
    expect(qrSvg("hello")).toContain("<path");
    expect(qrTerminal("hello").split("\n").length).toBeGreaterThan(10);
  });

  it("prints the setup URL and code for a data dir, then reports setup done", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "slate-cli-"));
    const auth = new AuthStore(dataDir);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await runCli(["setup-url", "--data-dir", dataDir, "--port", "9000"])).toBe(0);
    const out = log.mock.calls.flat().join("\n");
    expect(out).toContain("http://localhost:9000/setup");
    expect(out).toContain(auth.setupCode!);
    auth.createAdmin(PASSWORD);
    log.mockClear();
    expect(await runCli(["setup-url", "--data-dir", dataDir])).toBe(0);
    expect(log.mock.calls.flat().join("\n")).toContain("already done");
    log.mockRestore();
  });

  it("rejects unknown commands", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runCli(["frobnicate"])).toBe(1);
    err.mockRestore();
  });
});
