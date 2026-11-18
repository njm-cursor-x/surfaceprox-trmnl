import { parseDuration, type Duration } from "@slate/sdk/duration";
import { inWindow, localTime, type Weekday } from "./time.ts";

export interface ScheduleRule {
  days?: Weekday[];
  from?: string;
  to?: string;
}

export interface PlaylistItem {
  screen: string;
  dwell: Duration;
  when?: ScheduleRule;
}

export interface Playlist {
  items: PlaylistItem[];
}

export function ruleMatches(rule: ScheduleRule | undefined, now: Date, timeZone?: string): boolean {
  if (!rule) return true;
  const t = localTime(now, timeZone);
  if (rule.days && rule.days.length > 0 && !rule.days.includes(t.weekday)) return false;
  if (rule.from || rule.to) return inWindow(t.minutes, rule.from ?? "00:00", rule.to ?? "00:00");
  return true;
}

export function activeItems(playlist: Playlist, now: Date, timeZone?: string): PlaylistItem[] {
  return playlist.items.filter((item) => ruleMatches(item.when, now, timeZone));
}

export interface PlaylistPosition {
  item: PlaylistItem;
  index: number;
  /** Milliseconds until the next screen change. */
  remainingMs: number;
}

/**
 * Deterministic rotation: given when the cycle started, which active item shows now.
 * Every display on the same playlist and epoch shows the same screen.
 */
export function currentItem(
  playlist: Playlist,
  now: Date,
  epoch: Date = new Date(0),
  timeZone?: string,
): PlaylistPosition | null {
  const items = activeItems(playlist, now, timeZone);
  if (items.length === 0) return null;
  const dwells = items.map((i) => Math.max(1_000, parseDuration(i.dwell)));
  const total = dwells.reduce((a, b) => a + b, 0);
  let offset = (((now.getTime() - epoch.getTime()) % total) + total) % total;
  for (let index = 0; index < items.length; index++) {
    const d = dwells[index]!;
    if (offset < d) return { item: items[index]!, index, remainingMs: d - offset };
    offset -= d;
  }
  return { item: items[0]!, index: 0, remainingMs: dwells[0]! };
}
