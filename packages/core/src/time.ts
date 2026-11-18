export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface LocalTime {
  weekday: Weekday;
  /** Minutes since local midnight. */
  minutes: number;
}

/** Local weekday and minute-of-day for `date` in an IANA time zone (default: runtime zone). */
export function localTime(date: Date, timeZone?: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: get("weekday").toLowerCase().slice(0, 3) as Weekday,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function parseClock(value: string): number {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new Error(`Invalid time "${value}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** True when `minutes` falls in [from, to). Windows that cross midnight wrap. */
export function inWindow(minutes: number, from: string, to: string): boolean {
  const start = parseClock(from);
  const end = parseClock(to);
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
