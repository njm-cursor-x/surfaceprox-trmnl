import { readFileSync } from "node:fs";
import { HostNotAllowedError } from "@slate/sdk";
import { fixtureFetch, testConnector } from "@slate/sdk/testing";
import { describe, expect, it } from "vitest";
import openMeteo from "../connector.ts";

const forecast = JSON.parse(
  readFileSync(new URL("./fixtures/forecast.json", import.meta.url), "utf8"),
);
const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

describe("open-meteo connector", () => {
  it("is keyless, host-scoped, and quota-limited under the free tier", () => {
    expect(openMeteo.secrets).toBeUndefined();
    expect(openMeteo.hosts).toEqual(["api.open-meteo.com"]);
    expect(openMeteo.refreshMs).toBe(15 * 60_000);
    expect(openMeteo.quota!.perDay).toBeLessThan(10_000);
  });

  it("normalizes the forecast", async () => {
    const f = fixtureFetch({ [ENDPOINT]: forecast });
    const data = await testConnector(openMeteo, {
      config: { lat: 10, lon: 20, units: "fahrenheit" },
      fetch: f,
    });
    expect(data.now).toEqual({ temp: 72, feels: 70, code: 2, wind: 7, time: "2026-11-18T21:00" });
    expect(data.units).toBe("°F");
    expect(data.days).toHaveLength(5);
    expect(data.days[0]).toEqual({ date: "2026-11-18T12:00:00", hi: 74, lo: 58, code: 2 });
  });

  it("requests the user's coordinates and units", async () => {
    const f = fixtureFetch({ [ENDPOINT]: forecast });
    await testConnector(openMeteo, {
      config: { lat: "47.6", lon: -122.3, units: "celsius" } as never,
      fetch: f,
    });
    const params = f.calls[0]!.searchParams;
    expect(params.get("latitude")).toBe("47.6");
    expect(params.get("longitude")).toBe("-122.3");
    expect(params.get("temperature_unit")).toBe("celsius");
    expect(params.get("wind_speed_unit")).toBe("kmh");
  });

  it("surfaces HTTP errors", async () => {
    const f = fixtureFetch({ [ENDPOINT]: new Response("slow down", { status: 429 }) });
    await expect(
      testConnector(openMeteo, { config: { lat: 1, lon: 2 }, fetch: f }),
    ).rejects.toThrow(/429/);
  });

  it("requires a location", async () => {
    await expect(
      testConnector(openMeteo, { config: {} as never, fetch: fixtureFetch({}) }),
    ).rejects.toThrow();
  });

  it("cannot reach undeclared hosts", async () => {
    const sneaky = { ...openMeteo, hosts: ["example.com"] };
    await expect(
      testConnector(sneaky, { config: { lat: 1, lon: 2 }, fetch: fixtureFetch({}) }),
    ).rejects.toBeInstanceOf(HostNotAllowedError);
  });
});
