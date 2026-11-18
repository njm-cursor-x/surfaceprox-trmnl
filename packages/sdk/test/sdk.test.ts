import { describe, expect, it } from "vitest";
import {
  createScopedFetch,
  defineConnector,
  defineExtension,
  defineWidget,
  HostNotAllowedError,
  parseDuration,
  z,
} from "../src/index.ts";
import { fixtureFetch, testConnector } from "../src/testing.ts";

describe("parseDuration", () => {
  it.each([
    ["30s", 30_000],
    ["15m", 900_000],
    ["2h", 7_200_000],
    ["1d", 86_400_000],
    ["250ms", 250],
    [5000, 5000],
  ] as const)("%s -> %d", (input, ms) => expect(parseDuration(input)).toBe(ms));

  it("rejects garbage", () => {
    expect(() => parseDuration("soon" as never)).toThrow();
    expect(() => parseDuration(-1)).toThrow();
  });
});

describe("createScopedFetch", () => {
  const ok = async () => new Response("ok");

  it("allows declared hosts and subdomain wildcards", async () => {
    const f = createScopedFetch(["api.example.com", "*.cdn.example.com"], ok);
    await expect(f("https://api.example.com/x")).resolves.toBeInstanceOf(Response);
    await expect(f("https://img.cdn.example.com/a.png")).resolves.toBeInstanceOf(Response);
  });

  it("blocks undeclared hosts, lookalikes, and non-http schemes", async () => {
    const f = createScopedFetch(["api.example.com", "*.cdn.example.com"], ok);
    await expect(f("https://evil.com/")).rejects.toBeInstanceOf(HostNotAllowedError);
    await expect(f("https://api.example.com.evil.com/")).rejects.toBeInstanceOf(
      HostNotAllowedError,
    );
    await expect(f("https://cdn.example.com/")).rejects.toBeInstanceOf(HostNotAllowedError);
    await expect(f("file:///etc/passwd")).rejects.toBeInstanceOf(HostNotAllowedError);
  });
});

describe("defineConnector", () => {
  const base = { config: z.object({}), hosts: [], fetch: async () => 1 };

  it("computes refresh intervals", () => {
    const c = defineConnector({ ...base, id: "demo", refresh: { every: "15m", min: "5m" } });
    expect(c.kind).toBe("connector");
    expect(c.refreshMs).toBe(900_000);
    expect(c.minRefreshMs).toBe(300_000);
  });

  it("validates id and refresh bounds", () => {
    expect(() => defineConnector({ ...base, id: "Bad Id", refresh: { every: "1m" } })).toThrow(
      /kebab-case/,
    );
    expect(() =>
      defineConnector({ ...base, id: "x", refresh: { every: "1m", min: "5m" } }),
    ).toThrow(/refresh.min/);
  });
});

describe("defineWidget", () => {
  it("derives layouts from provided templates and fills default sizes", () => {
    const w = defineWidget({
      id: "w",
      name: "W",
      templates: { full: "a", quadrant: "b", shared: "c" },
    });
    expect(w.layouts).toEqual(["full", "quadrant"]);
    expect(w.sizes.min).toEqual({ w: 2, h: 2 });
  });

  it("requires a layout template and sane sizes", () => {
    expect(() => defineWidget({ id: "w", name: "W", templates: { shared: "x" } })).toThrow(
      /at least one/,
    );
    expect(() =>
      defineWidget({
        id: "w",
        name: "W",
        templates: { full: "x" },
        sizes: { min: { w: 6, h: 6 }, max: { w: 4, h: 4 } },
      }),
    ).toThrow(/sizes.min exceeds sizes.max/);
    expect(() =>
      defineWidget({
        id: "w",
        name: "W",
        templates: { full: "x" },
        templateRules: { "w<=3": "quadrant" },
      }),
    ).toThrow(/missing layout/);
  });
});

describe("defineExtension", () => {
  it("validates point names", () => {
    expect(defineExtension({ point: "clock.face", id: "word" }).kind).toBe("extension");
    expect(() => defineExtension({ point: "clock", id: "word" })).toThrow();
  });
});

describe("testConnector", () => {
  const echo = defineConnector({
    id: "echo",
    config: z.object({ q: z.string() }),
    hosts: ["api.example.com"],
    refresh: { every: "1m" },
    async fetch({ config, fetch }) {
      const res = await fetch(`https://api.example.com/search?q=${config.q}`);
      return res.json();
    },
  });

  it("runs with fixtures and validates config", async () => {
    const f = fixtureFetch({
      "https://api.example.com/search": (u: URL) => ({ q: u.searchParams.get("q") }),
    });
    await expect(testConnector(echo, { config: { q: "hi" }, fetch: f })).resolves.toEqual({
      q: "hi",
    });
    expect(f.calls).toHaveLength(1);
    await expect(testConnector(echo, { config: { q: 1 } as never, fetch: f })).rejects.toThrow();
  });
});
