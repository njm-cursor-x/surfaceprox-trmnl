import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { defineExtension, LAYOUTS, type Connector, type Extension, type Widget } from "@slate/sdk";
import { parse as parseYaml } from "yaml";
import { widgetFromManifest, type TrmnlSettings, type WidgetFiles } from "../manifest.ts";
import { Registry } from "../registry.ts";

export interface LoadOptions {
  /** Prefer `connector.ts` over a built `connector.mjs` (dev, with a TS loader). */
  preferSource?: boolean;
}

const BUILT_FIRST = ["connector.mjs", "connector.js", "connector.ts"];
const SOURCE_FIRST = ["connector.ts", "connector.mjs", "connector.js"];

function readIf(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function subdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

function readWidgetFiles(dir: string): WidgetFiles {
  const templates: WidgetFiles["templates"] = {};
  for (const name of [...LAYOUTS, "shared"] as const) {
    const src = readIf(join(dir, "src", `${name}.liquid`));
    if (src !== undefined) templates[name] = src;
  }
  return {
    templates,
    client: readIf(join(dir, "client.js")),
    style: readIf(join(dir, "style.css")),
  };
}

function loadWidget(dir: string, fallbackId: string): Widget {
  const settings = (parseYaml(readFileSync(join(dir, "settings.yml"), "utf8")) ??
    {}) as TrmnlSettings;
  return widgetFromManifest(fallbackId, settings, readWidgetFiles(dir));
}

function loadExtensions(dir: string): Extension[] {
  const root = join(dir, "extensions");
  return subdirs(root).flatMap((point) =>
    subdirs(join(root, point)).map((id) => {
      const extDir = join(root, point, id);
      const meta = (parseYaml(readIf(join(extDir, "extension.yml")) ?? "") ?? {}) as {
        name?: string;
      };
      return defineExtension({
        point,
        id,
        name: meta.name,
        template: readIf(join(extDir, "template.liquid")),
        client: readIf(join(extDir, "client.js")),
        style: readIf(join(extDir, "style.css")),
      });
    }),
  );
}

async function loadConnectors(dir: string, opts: LoadOptions): Promise<Connector[]> {
  const file = (opts.preferSource ? SOURCE_FIRST : BUILT_FIRST)
    .map((f) => join(dir, f))
    .find(existsSync);
  if (!file) return [];
  const mod = (await import(pathToFileURL(file).href)) as { default?: Connector | Connector[] };
  const exported = mod.default;
  const list = Array.isArray(exported) ? exported : exported ? [exported] : [];
  for (const c of list) {
    if (c?.kind !== "connector")
      throw new Error(`${file} must default-export defineConnector(...) results`);
  }
  return list;
}

/**
 * Loads one plugin folder: a root `settings.yml` widget (TRMNL recipe layout),
 * extra widgets under `widgets/<id>/`, an optional `connector.*`, and `extensions/<point>/<id>/`.
 */
export async function loadPlugin(
  dir: string,
  registry: Registry,
  opts: LoadOptions = {},
): Promise<void> {
  const pkg = JSON.parse(readIf(join(dir, "package.json")) ?? "{}") as {
    name?: string;
    version?: string;
  };
  const id = basename(dir);
  const widgets: Widget[] = [];
  if (existsSync(join(dir, "settings.yml"))) widgets.push(loadWidget(dir, id));
  for (const sub of subdirs(join(dir, "widgets")))
    widgets.push(loadWidget(join(dir, "widgets", sub), sub));
  const connectors = await loadConnectors(dir, opts);
  const extensions = loadExtensions(dir);
  if (widgets.length + connectors.length + extensions.length === 0) {
    throw new Error(`Plugin "${id}" has no widgets, connectors, or extensions`);
  }
  registry.addPlugin(
    { id, name: pkg.name ?? id, version: pkg.version, dir },
    { widgets, connectors, extensions },
  );
}

export interface LoadResult {
  registry: Registry;
  errors: { dir: string; error: string }[];
}

/** Loads every plugin under each root. A broken plugin is reported, not fatal. */
export async function loadPlugins(roots: string[], opts: LoadOptions = {}): Promise<LoadResult> {
  const registry = new Registry();
  const errors: LoadResult["errors"] = [];
  for (const root of roots) {
    for (const name of subdirs(root)) {
      const dir = join(root, name);
      try {
        await loadPlugin(dir, registry, opts);
      } catch (err) {
        errors.push({ dir, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return { registry, errors };
}
