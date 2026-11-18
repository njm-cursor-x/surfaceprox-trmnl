import { z } from "zod";
import { DEFAULT_NIGHT } from "./night.ts";
import { WEEKDAYS } from "./time.ts";

const clock = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
const duration = z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d+)?(ms|s|m|h|d)$/)]);
const id = z.string().regex(/^[a-z0-9][a-z0-9-_]*$/i, "Use letters, numbers, - or _");

export const LocationSchema = z.object({
  name: z.string().default(""),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  timezone: z.string().optional(),
});

export const NightSchema = z.object({
  enabled: z.boolean().default(DEFAULT_NIGHT.enabled),
  from: clock.default(DEFAULT_NIGHT.from),
  to: clock.default(DEFAULT_NIGHT.to),
  dim: z.number().min(0).max(0.95).default(DEFAULT_NIGHT.dim),
  theme: z.string().nullable().default(DEFAULT_NIGHT.theme),
});

export const GridSchema = z.object({
  cols: z.number().int().min(1).max(48).default(12),
  rows: z.number().int().min(1).max(32).default(8),
  gap: z.number().min(0).max(64).default(8),
  items: z
    .array(
      z.object({
        instance: id,
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        w: z.number().int().min(1),
        h: z.number().int().min(1),
      }),
    )
    .default([]),
});

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  /** Set by the user in the wizard or config UI. Never defaulted to a real city. */
  location: LocationSchema.nullable().default(null),
  units: z
    .object({
      temperature: z.enum(["fahrenheit", "celsius"]).default("fahrenheit"),
      time: z.enum(["12h", "24h"]).default("12h"),
    })
    .prefault({}),
  instances: z
    .record(
      id,
      z.object({
        widget: z.string(),
        name: z.string().optional(),
        settings: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .default({}),
  screens: z
    .record(id, z.object({ name: z.string().optional(), grid: GridSchema.prefault({}) }))
    .default({}),
  playlists: z
    .record(
      id,
      z.object({
        items: z.array(
          z.object({
            screen: id,
            dwell: duration.default("1m"),
            when: z
              .object({
                days: z.array(z.enum(WEEKDAYS)).optional(),
                from: clock.optional(),
                to: clock.optional(),
              })
              .optional(),
          }),
        ),
      }),
    )
    .default({}),
  displays: z
    .record(
      id,
      z.object({
        name: z.string().optional(),
        token: z.string().min(16, "Display tokens must be at least 16 characters"),
        playlist: id,
        theme: z.string().default("paper"),
        timezone: z.string().optional(),
        width: z.number().int().min(100).default(1440),
        height: z.number().int().min(100).default(960),
        pixelShift: z.boolean().default(true),
        night: NightSchema.prefault({}),
      }),
    )
    .default({}),
});

export type SlateConfig = z.infer<typeof ConfigSchema>;
export type SlateConfigInput = z.input<typeof ConfigSchema>;
export type DisplayConfig = SlateConfig["displays"][string];
export type InstanceConfig = SlateConfig["instances"][string];

export function parseConfig(input: unknown): SlateConfig {
  return ConfigSchema.parse(input ?? {});
}

export interface ConfigIssue {
  path: string;
  message: string;
}

/** Cross-reference checks the schema can't express. */
export function referenceIssues(
  config: SlateConfig,
  knownWidgets: ReadonlySet<string>,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const [name, inst] of Object.entries(config.instances)) {
    if (!knownWidgets.has(inst.widget)) {
      issues.push({ path: `instances.${name}.widget`, message: `Unknown widget "${inst.widget}"` });
    }
  }
  for (const [name, screen] of Object.entries(config.screens)) {
    screen.grid.items.forEach((item, i) => {
      if (!config.instances[item.instance]) {
        issues.push({
          path: `screens.${name}.grid.items.${i}`,
          message: `Unknown instance "${item.instance}"`,
        });
      }
    });
  }
  for (const [name, pl] of Object.entries(config.playlists)) {
    pl.items.forEach((item, i) => {
      if (!config.screens[item.screen]) {
        issues.push({
          path: `playlists.${name}.items.${i}`,
          message: `Unknown screen "${item.screen}"`,
        });
      }
    });
  }
  const tokens = new Set<string>();
  for (const [name, d] of Object.entries(config.displays)) {
    if (!config.playlists[d.playlist]) {
      issues.push({
        path: `displays.${name}.playlist`,
        message: `Unknown playlist "${d.playlist}"`,
      });
    }
    if (tokens.has(d.token))
      issues.push({ path: `displays.${name}.token`, message: "Token is reused" });
    tokens.add(d.token);
  }
  return issues;
}
