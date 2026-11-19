import { randomBytes } from "node:crypto";
import {
  applyTemplate,
  layoutTemplate,
  parseConfig,
  type DisplayConfig,
  type SlateConfig,
  type SlateConfigInput,
} from "@slate/core";

interface StarterInstance {
  id: string;
  widget: string;
  name?: string;
  settings?: Record<string, unknown>;
}

export interface Starter {
  id: string;
  name: string;
  description: string;
  /** A layout template id from @slate/core; instances fill its slots in order. */
  layout: string;
  instances: StarterInstance[];
}

/** Starter screens use keyless widgets only, so they work right after setup. */
export const STARTERS: readonly Starter[] = [
  {
    id: "clock-weather",
    name: "Clock + Weather",
    description: "A big digital clock beside today's weather and forecast.",
    layout: "halves",
    instances: [
      { id: "clock", widget: "clock", settings: { face: "digital" } },
      { id: "weather", widget: "weather" },
    ],
  },
  {
    id: "morning",
    name: "Morning",
    description: "Weather up front, with a digital and an analog clock on the side.",
    layout: "one-plus-two",
    instances: [
      { id: "weather", widget: "weather" },
      { id: "clock", widget: "clock", settings: { face: "digital" } },
      { id: "analog", widget: "clock", name: "Analog clock", settings: { face: "analog" } },
    ],
  },
  {
    id: "big-clock",
    name: "Big clock",
    description: "One full-screen clock with seconds. Nothing to set up.",
    layout: "full",
    instances: [{ id: "clock", widget: "clock", settings: { face: "digital", seconds: "yes" } }],
  },
];

export const DEFAULT_STARTER = "clock-weather";

export const newToken = () => randomBytes(18).toString("base64url");

/** New displays start with night mode off; the wizard and config page turn it on. */
export function newDisplay(playlist: string, name = "This display"): DisplayConfig {
  return parseConfig({
    playlists: { [playlist]: { items: [] } },
    displays: { d: { name, token: newToken(), playlist, night: { enabled: false } } },
  }).displays.d!;
}

/**
 * Replaces instances, screens, and playlists with a starter. Location, units, and
 * displays (tokens, night schedules) are kept, and every display shows the starter.
 */
export function applyStarter(config: SlateConfig, starterId: string): SlateConfig {
  const starter = STARTERS.find((s) => s.id === starterId);
  if (!starter) throw new Error(`Unknown starter "${starterId}"`);
  const template = layoutTemplate(starter.layout)!;
  const input: SlateConfigInput = {
    ...config,
    instances: Object.fromEntries(
      starter.instances.map((i) => [
        i.id,
        { widget: i.widget, name: i.name, settings: i.settings ?? {} },
      ]),
    ),
    screens: {
      home: {
        name: starter.name,
        grid: applyTemplate(
          template,
          starter.instances.map((i) => i.id),
        ),
      },
    },
    playlists: { default: { items: [{ screen: "home", dwell: "5m" }] } },
    displays: Object.fromEntries(
      Object.entries(config.displays).map(([id, d]) => [id, { ...d, playlist: "default" }]),
    ),
  };
  return parseConfig(input);
}
