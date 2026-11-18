export type Duration = number | `${number}${"ms" | "s" | "m" | "h" | "d"}`;

const UNIT_MS = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Converts a duration (`"15m"`, `"30s"`, or milliseconds) to milliseconds. */
export function parseDuration(value: Duration): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid duration: ${value}`);
    return value;
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: ${value}`);
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}
