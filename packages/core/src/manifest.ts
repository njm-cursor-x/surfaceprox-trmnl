import {
  defineWidget,
  LAYOUTS,
  type ConnectorBinding,
  type CustomField,
  type LayoutName,
  type SizeConstraints,
  type Widget,
} from "@slate/sdk";

/** The `slate:` block added on top of TRMNL's settings.yml. Unknown keys are ignored. */
export interface SlateManifestBlock {
  id?: string;
  sizes?: Partial<SizeConstraints>;
  templates?: Record<string, LayoutName>;
  connectors?: Record<string, ConnectorBinding>;
  embeds?: string[];
  extension_points?: string[];
  /** CSS base for the widget. Plain TRMNL recipes (no `slate:` block) get `trmnl`. */
  framework?: "trmnl" | "slate";
}

export interface TrmnlSettings {
  name?: string;
  description?: string;
  refresh_frequency?: number;
  custom_fields?: CustomField[];
  slate?: SlateManifestBlock;
  [key: string]: unknown;
}

export interface WidgetFiles {
  templates: Partial<Record<LayoutName | "shared", string>>;
  client?: string;
  style?: string;
}

/** Turns a TRMNL-compatible settings.yml plus its Liquid files into a widget. */
export function widgetFromManifest(
  fallbackId: string,
  settings: TrmnlSettings,
  files: WidgetFiles,
): Widget {
  const s = settings.slate ?? {};
  for (const target of Object.values(s.templates ?? {})) {
    if (!(LAYOUTS as readonly string[]).includes(target))
      throw new Error(`Unknown layout "${target}"`);
  }
  return defineWidget({
    id: s.id ?? fallbackId,
    name: settings.name ?? fallbackId,
    description: settings.description,
    templates: files.templates,
    templateRules: s.templates,
    sizes: s.sizes,
    connectors: s.connectors,
    fields: settings.custom_fields,
    client: files.client,
    style: files.style,
    embeds: s.embeds,
    extensionPoints: s.extension_points,
    framework: s.framework ?? (settings.slate ? "slate" : "trmnl"),
    refreshMinutes: settings.refresh_frequency,
  });
}
