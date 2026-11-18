const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Showers",
  81: "Showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm, hail",
  99: "Thunderstorm, hail",
};

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value < 1e12 ? value * 1000 : value);
  if (typeof value === "string" && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** TRMNL's `number_with_delimiter`: 1234567.891 -> "1,234,567.891". */
export function numberWithDelimiter(value: unknown, delimiter = ",", separator = "."): string {
  const [int, frac] = String(toNumber(value)).split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, delimiter);
  return frac ? `${grouped}${separator}${frac}` : grouped;
}

/** TRMNL's `number_to_currency`: 1234.5 -> "$1,234.50". */
export function numberToCurrency(
  value: unknown,
  unit = "$",
  delimiter = ",",
  separator = ".",
  precision = 2,
) {
  const n = toNumber(value);
  const fixed = Math.abs(n).toFixed(precision);
  const [int, frac] = fixed.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, delimiter);
  return `${n < 0 ? "-" : ""}${unit}${grouped}${frac ? separator + frac : ""}`;
}

/** TRMNL's `pluralize`: `{{ 3 | pluralize: "book" }}` -> "3 books". */
export function pluralize(count: unknown, singular: string, plural?: string): string {
  const n = toNumber(count);
  return `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

export function ordinalize(value: unknown): string {
  const n = Math.trunc(toNumber(value));
  const mod100 = Math.abs(n) % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[Math.abs(n) % 10] ?? "th");
  return `${n}${suffix}`;
}

/** TRMNL's `days_ago`: date `n` days before now, as YYYY-MM-DD. */
export function daysAgo(value: unknown, now = new Date()): string {
  const d = new Date(now.getTime() - toNumber(value) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Short relative age: "just now", "12m ago", "3h ago", "2d ago". */
export function timeAgo(value: unknown, now = new Date()): string {
  const d = toDate(value);
  if (!d) return "";
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function groupBy(list: unknown, key: string): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const item of Array.isArray(list) ? list : []) {
    const k = String((item as Record<string, unknown>)?.[key] ?? "");
    (out[k] ??= []).push(item);
  }
  return out;
}

export function findBy(
  list: unknown,
  key: string,
  value: unknown,
  fallback: unknown = null,
): unknown {
  const found = (Array.isArray(list) ? list : []).find(
    (item) => (item as Record<string, unknown>)?.[key] === value,
  );
  return found ?? fallback;
}

export function parseJson(value: unknown): unknown {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

export function wmoLabel(code: unknown): string {
  return WMO[Math.trunc(toNumber(code))] ?? "Unknown";
}
