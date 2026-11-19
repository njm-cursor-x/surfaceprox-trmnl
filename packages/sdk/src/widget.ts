export const LAYOUTS = ["full", "half_horizontal", "half_vertical", "quadrant"] as const;
export type LayoutName = (typeof LAYOUTS)[number];

/** Grid units, expressed against the 12x8 base grid and scaled for other densities. */
export interface GridSize {
  w: number;
  h: number;
}

export interface SizeConstraints {
  min: GridSize;
  max: GridSize;
  default: GridSize;
  presets?: Record<string, GridSize>;
  /** Limits on w/h measured in display proportions. */
  aspect?: { min?: number; max?: number };
}

/**
 * Binds a widget alias to a connector. `with` values may be Liquid strings such as
 * `"{{ location.lat }}"` or `"{{ settings.units }}"`, resolved per widget instance.
 */
export interface ConnectorBinding {
  use: string;
  with?: Record<string, unknown>;
}

/** TRMNL `custom_fields` entry. */
export interface CustomField {
  keyname: string;
  field_type: string;
  name?: string;
  default?: unknown;
  options?: unknown[];
  optional?: boolean;
}

export interface WidgetDefinition {
  id: string;
  name: string;
  description?: string;
  /** Liquid sources per TRMNL layout, plus optional `shared` partials. */
  templates: Partial<Record<LayoutName | "shared", string>>;
  /** Slot-shape overrides, e.g. `{ "w<=3": "quadrant" }`. Evaluated in 12x8 units. */
  templateRules?: Record<string, LayoutName>;
  sizes?: Partial<SizeConstraints>;
  connectors?: Record<string, ConnectorBinding>;
  fields?: CustomField[];
  /** Script run inside the widget's sandboxed iframe for live elements. */
  client?: string;
  style?: string;
  /** Third-party origins the widget may frame (for example a video player). */
  embeds?: string[];
  /** Extension points whose contributions this widget renders, e.g. `clock.face`. */
  extensionPoints?: string[];
  refreshMinutes?: number;
  /**
   * `trmnl` wraps the widget in the vendored TRMNL Framework (`.trmnl .screen .view`);
   * `slate` (default) uses Slate's theme-token base styles only.
   */
  framework?: "trmnl" | "slate";
}

export interface Widget extends WidgetDefinition {
  readonly kind: "widget";
  readonly layouts: LayoutName[];
  readonly sizes: SizeConstraints;
}

export const DEFAULT_SIZES: SizeConstraints = {
  min: { w: 2, h: 2 },
  max: { w: 12, h: 8 },
  default: { w: 4, h: 3 },
};

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function fits(inner: GridSize, outer: GridSize): boolean {
  return inner.w <= outer.w && inner.h <= outer.h;
}

export function defineWidget(def: WidgetDefinition): Widget {
  if (!ID_RE.test(def.id)) throw new Error(`Widget id "${def.id}" must be kebab-case`);
  const layouts = LAYOUTS.filter((l) => typeof def.templates[l] === "string");
  if (layouts.length === 0) {
    throw new Error(`Widget "${def.id}" needs at least one of: ${LAYOUTS.join(", ")}`);
  }
  const sizes: SizeConstraints = {
    ...DEFAULT_SIZES,
    ...def.sizes,
    min: def.sizes?.min ?? DEFAULT_SIZES.min,
    max: def.sizes?.max ?? DEFAULT_SIZES.max,
    default: def.sizes?.default ?? def.sizes?.min ?? DEFAULT_SIZES.default,
  };
  if (!fits(sizes.min, sizes.max))
    throw new Error(`Widget "${def.id}": sizes.min exceeds sizes.max`);
  if (!fits(sizes.min, sizes.default) || !fits(sizes.default, sizes.max)) {
    throw new Error(`Widget "${def.id}": sizes.default must be within min..max`);
  }
  for (const rule of Object.values(def.templateRules ?? {})) {
    if (!layouts.includes(rule)) {
      throw new Error(`Widget "${def.id}": template rule targets missing layout "${rule}"`);
    }
  }
  return Object.freeze({ ...def, kind: "widget" as const, layouts, sizes });
}

export interface ExtensionDefinition {
  point: string;
  id: string;
  name?: string;
  template?: string;
  client?: string;
  style?: string;
}

export interface Extension extends ExtensionDefinition {
  readonly kind: "extension";
}

export function defineExtension(def: ExtensionDefinition): Extension {
  if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(def.point)) {
    throw new Error(`Extension point "${def.point}" must look like "clock.face"`);
  }
  if (!ID_RE.test(def.id)) throw new Error(`Extension id "${def.id}" must be kebab-case`);
  return Object.freeze({ ...def, kind: "extension" as const });
}
