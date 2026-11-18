import { inWindow, localTime } from "./time.ts";

export interface NightMode {
  enabled: boolean;
  from: string;
  to: string;
  /** Overlay opacity 0..0.95. 0 disables dimming. */
  dim: number;
  /** Theme to switch to at night, or null to keep the day theme. */
  theme: string | null;
}

export const DEFAULT_NIGHT: NightMode = {
  enabled: true,
  from: "22:00",
  to: "07:00",
  dim: 0.6,
  theme: "ink-dark",
};

export interface NightState {
  active: boolean;
  dim: number;
  theme: string;
}

/**
 * Night mode never turns the display off: on the Surface that would drop into
 * Modern Standby and take the on-device server's Wi-Fi with it.
 */
export function nightState(
  night: NightMode,
  dayTheme: string,
  now: Date,
  timeZone?: string,
): NightState {
  const active = night.enabled && inWindow(localTime(now, timeZone).minutes, night.from, night.to);
  if (!active) return { active: false, dim: 0, theme: dayTheme };
  return {
    active: true,
    dim: Math.min(0.95, Math.max(0, night.dim)),
    theme: night.theme ?? dayTheme,
  };
}
