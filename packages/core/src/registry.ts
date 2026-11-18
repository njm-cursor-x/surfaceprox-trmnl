import type { Connector, Extension, Widget } from "@slate/sdk";

export interface PluginInfo {
  id: string;
  name: string;
  version?: string;
  dir?: string;
  widgets: string[];
  connectors: string[];
  extensions: string[];
}

export class Registry {
  readonly plugins: PluginInfo[] = [];
  readonly widgets = new Map<string, Widget>();
  readonly connectors = new Map<string, Connector>();
  readonly extensions = new Map<string, Map<string, Extension>>();

  addPlugin(
    info: Omit<PluginInfo, "widgets" | "connectors" | "extensions">,
    parts: {
      widgets?: Widget[];
      connectors?: Connector[];
      extensions?: Extension[];
    },
  ): PluginInfo {
    if (this.plugins.some((p) => p.id === info.id))
      throw new Error(`Plugin "${info.id}" is already loaded`);
    for (const w of parts.widgets ?? []) {
      if (this.widgets.has(w.id))
        throw new Error(`Widget "${w.id}" from "${info.id}" is already registered`);
    }
    for (const c of parts.connectors ?? []) {
      if (this.connectors.has(c.id))
        throw new Error(`Connector "${c.id}" from "${info.id}" is already registered`);
    }
    for (const w of parts.widgets ?? []) this.widgets.set(w.id, w);
    for (const c of parts.connectors ?? []) this.connectors.set(c.id, c);
    for (const e of parts.extensions ?? []) {
      const point = this.extensions.get(e.point) ?? new Map<string, Extension>();
      point.set(e.id, e);
      this.extensions.set(e.point, point);
    }
    const plugin: PluginInfo = {
      ...info,
      widgets: (parts.widgets ?? []).map((w) => w.id),
      connectors: (parts.connectors ?? []).map((c) => c.id),
      extensions: (parts.extensions ?? []).map((e) => `${e.point}/${e.id}`),
    };
    this.plugins.push(plugin);
    return plugin;
  }

  extensionsFor(point: string): Extension[] {
    return [...(this.extensions.get(point)?.values() ?? [])];
  }
}
