import { defineConnector, z } from "@slate/sdk";

interface OpenMeteoResponse {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
  };
}

export default defineConnector({
  id: "open-meteo",
  name: "Open-Meteo",
  config: z.object({
    lat: z.coerce.number().min(-90).max(90),
    lon: z.coerce.number().min(-180).max(180),
    units: z.enum(["fahrenheit", "celsius"]).default("fahrenheit"),
  }),
  hosts: ["api.open-meteo.com"],
  refresh: { every: "15m", min: "5m" },
  // Open-Meteo's free tier is ~10k calls/day for non-commercial use.
  quota: { perMinute: 60, perDay: 9000 },
  async fetch({ config, fetch, signal }) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(config.lat),
      longitude: String(config.lon),
      current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
      daily: "temperature_2m_max,temperature_2m_min,weather_code",
      temperature_unit: config.units,
      wind_speed_unit: config.units === "fahrenheit" ? "mph" : "kmh",
      timezone: "auto",
      forecast_days: "5",
    }).toString();
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
    const r = (await res.json()) as OpenMeteoResponse;
    return {
      units: config.units === "fahrenheit" ? "°F" : "°C",
      now: {
        temp: Math.round(r.current.temperature_2m),
        feels: Math.round(r.current.apparent_temperature),
        code: r.current.weather_code,
        wind: Math.round(r.current.wind_speed_10m),
        time: r.current.time,
      },
      days: r.daily.time.map((date, i) => ({
        // Midday so Liquid's `date` filter can't shift the day in any time zone.
        date: `${date}T12:00:00`,
        hi: Math.round(r.daily.temperature_2m_max[i]!),
        lo: Math.round(r.daily.temperature_2m_min[i]!),
        code: r.daily.weather_code[i]!,
      })),
    };
  },
});
