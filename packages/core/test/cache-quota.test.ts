import { describe, expect, it, vi } from "vitest";
import {
  ConnectorCache,
  connectorKey,
  QuotaTracker,
  resolveBinding,
  stableStringify,
} from "../src/index.ts";

describe("connectorKey", () => {
  it("is stable across key order and differs by config", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(connectorKey("x", { lat: 1, lon: 2 })).toBe(connectorKey("x", { lon: 2, lat: 1 }));
    expect(connectorKey("x", { lat: 1 })).not.toBe(connectorKey("x", { lat: 2 }));
    expect(connectorKey("x", { lat: 1 })).not.toBe(connectorKey("y", { lat: 1 }));
  });
});

describe("ConnectorCache", () => {
  it("serves stale data while revalidating and keeps last good data on error", async () => {
    const cache = new ConnectorCache();
    let now = 1_000;
    await cache.refresh(
      "k",
      async () => ({ v: 1 }),
      () => now,
    );
    expect(cache.read("k", 500, now)).toMatchObject({ data: { v: 1 }, stale: false });
    now = 2_000;
    expect(cache.read("k", 500, now)).toMatchObject({ data: { v: 1 }, stale: true });
    await cache.refresh(
      "k",
      async () => Promise.reject(new Error("boom")),
      () => now,
    );
    expect(cache.read("k", 500, now)).toMatchObject({
      data: { v: 1 },
      error: "boom",
      fetchedAt: 1_000,
    });
  });

  it("dedupes concurrent refreshes of one key", async () => {
    const cache = new ConnectorCache();
    const fetcher = vi.fn(async () => 42);
    await Promise.all([
      cache.refresh("k", fetcher),
      cache.refresh("k", fetcher),
      cache.refresh("k", fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("QuotaTracker", () => {
  it("enforces sliding windows", () => {
    const q = new QuotaTracker({ perMinute: 2, perDay: 3 });
    expect(q.tryAcquire(0).ok).toBe(true);
    expect(q.tryAcquire(1_000).ok).toBe(true);
    expect(q.tryAcquire(2_000)).toEqual({ ok: false, retryAt: 60_000 });
    expect(q.tryAcquire(60_001).ok).toBe(true);
    expect(q.tryAcquire(200_000)).toEqual({ ok: false, retryAt: 86_400_000 });
    expect(q.usage(200_000)).toEqual({ perMinute: 0, perHour: 3, perDay: 3 });
  });

  it("backs off exponentially after rate limits and honors Retry-After", () => {
    const q = new QuotaTracker();
    expect(q.rateLimited(0)).toBe(30_000);
    expect(q.check(10_000).ok).toBe(false);
    expect(q.rateLimited(30_000)).toBe(90_000);
    expect(q.rateLimited(90_000, 600_000)).toBe(690_000);
    q.succeeded();
    expect(q.rateLimited(700_000)).toBe(730_000);
  });
});

describe("resolveBinding", () => {
  const scope = {
    settings: { units: "celsius", lat: undefined },
    location: { lat: 47.6, lon: -122.3, name: "Home" },
    units: { temperature: "fahrenheit" },
  };

  it("keeps types for whole expressions and interpolates strings", () => {
    expect(
      resolveBinding({ lat: "{{ location.lat }}", label: "At {{ location.name }}!", n: 3 }, scope),
    ).toEqual({ lat: 47.6, label: "At Home!", n: 3 });
  });

  it("supports default fallbacks to paths and literals", () => {
    expect(
      resolveBinding(
        {
          lat: "{{ settings.lat | default: location.lat }}",
          u: "{{ settings.missing | default: 'metric' }}",
          t: "{{ settings.units | default: units.temperature }}",
        },
        scope,
      ),
    ).toEqual({ lat: 47.6, u: "metric", t: "celsius" });
  });

  it("yields undefined when the location is unset", () => {
    expect(resolveBinding({ lat: "{{ location.lat }}" }, { location: null })).toEqual({
      lat: undefined,
    });
  });

  it("rejects unsupported filters", () => {
    expect(() => resolveBinding({ x: "{{ a | upcase }}" }, {})).toThrow(/Unsupported filter/);
  });
});
