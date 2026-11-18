import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPlugins } from "../src/node/index.ts";
import { parseConfig, referenceIssues } from "../src/index.ts";

const repoPlugins = fileURLToPath(new URL("../../../plugins", import.meta.url));

describe("config schema", () => {
  it("fills defaults without inventing a location", () => {
    const c = parseConfig({});
    expect(c.location).toBeNull();
    expect(c.units).toEqual({ temperature: "fahrenheit", time: "12h" });
  });

  it("fills display night defaults: display stays on, dim + dark", () => {
    const c = parseConfig({ displays: { d: { token: "x".repeat(16), playlist: "p" } } });
    expect(c.displays.d!.night).toEqual({
      enabled: true,
      from: "22:00",
      to: "07:00",
      dim: 0.6,
      theme: "ink-dark",
    });
    expect(c.displays.d!.pixelShift).toBe(true);
  });

  it("rejects bad values", () => {
    expect(() => parseConfig({ location: { lat: 200, lon: 0 } })).toThrow();
    expect(() => parseConfig({ displays: { d: { token: "short", playlist: "p" } } })).toThrow();
    expect(() =>
      parseConfig({
        displays: { d: { token: "x".repeat(16), playlist: "p", night: { from: "9pm" } } },
      }),
    ).toThrow();
  });

  it("reports broken cross-references", () => {
    const c = parseConfig({
      instances: { w: { widget: "nope" } },
      screens: { s: { grid: { items: [{ instance: "ghost", x: 0, y: 0, w: 1, h: 1 }] } } },
      playlists: { p: { items: [{ screen: "missing" }] } },
      displays: {
        d: { token: "t".repeat(16), playlist: "gone" },
        e: { token: "t".repeat(16), playlist: "p" },
      },
    });
    expect(referenceIssues(c, new Set(["clock"])).map((i) => i.message)).toEqual([
      'Unknown widget "nope"',
      'Unknown instance "ghost"',
      'Unknown screen "missing"',
      'Unknown playlist "gone"',
      "Token is reused",
    ]);
  });
});

describe("plugin loader", () => {
  it("loads first-party plugins: clock (widget + faces) and weather (connector + widget)", async () => {
    const { registry, errors } = await loadPlugins([repoPlugins], { preferSource: true });
    expect(errors).toEqual([]);
    expect([...registry.widgets.keys()].sort()).toEqual(["clock", "weather"]);
    expect([...registry.connectors.keys()]).toEqual(["open-meteo"]);
    expect(
      registry
        .extensionsFor("clock.face")
        .map((e) => e.id)
        .sort(),
    ).toEqual(["analog", "digital"]);
    const clock = registry.widgets.get("clock")!;
    expect(clock.layouts).toEqual(["full", "half_horizontal", "half_vertical", "quadrant"]);
    expect(clock.connectors).toBeUndefined();
    expect(clock.client).toContain("slateClock");
    expect(registry.widgets.get("weather")!.connectors!.weather!.use).toBe("open-meteo");
  });

  it("loads a bare TRMNL recipe and reports broken plugins without failing others", async () => {
    const root = mkdtempSync(join(tmpdir(), "slate-plugins-"));
    mkdirSync(join(root, "recipe", "src"), { recursive: true });
    writeFileSync(
      join(root, "recipe", "settings.yml"),
      "name: Recipe\nstrategy: static\nunknown_trmnl_key: 1\n",
    );
    writeFileSync(join(root, "recipe", "src", "full.liquid"), "<b>{{ settings.x }}</b>");
    mkdirSync(join(root, "broken"));
    writeFileSync(join(root, "broken", "settings.yml"), "name: Broken\n");
    mkdirSync(join(root, "empty"));

    const { registry, errors } = await loadPlugins([root]);
    expect(registry.widgets.get("recipe")).toMatchObject({ name: "Recipe", layouts: ["full"] });
    expect(errors.map((e) => e.error)).toEqual([
      expect.stringContaining("at least one"),
      expect.stringContaining("no widgets"),
    ]);
  });

  it("rejects duplicate widget ids across plugins", async () => {
    const root = mkdtempSync(join(tmpdir(), "slate-dupes-"));
    for (const name of ["one", "two"]) {
      mkdirSync(join(root, name, "src"), { recursive: true });
      writeFileSync(join(root, name, "settings.yml"), "name: Same\nslate:\n  id: same\n");
      writeFileSync(join(root, name, "src", "full.liquid"), "x");
    }
    const { registry, errors } = await loadPlugins([root]);
    expect(registry.widgets.size).toBe(1);
    expect(errors[0]!.error).toMatch(/already registered/);
  });
});
