import {
  pickTemplate,
  type GridItem,
  type GridLayout,
  type Registry,
  type SlateConfig,
} from "@slate/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADAPTER_CSS, FRAMEWORK_FILE, FRAMEWORK_VERSION, frameworkScale } from "@slate/framework";
import { renderTrmnl } from "@slate/liquid-trmnl";
import type { LayoutName } from "@slate/sdk";
import type { BindingState } from "./runtime.ts";
import { BASE_CSS, themeCss } from "./themes.ts";

export interface RenderedCell extends GridItem {
  widget: string;
  layout: LayoutName;
  html: string;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

// "</script" inside inline JS would end the element early.
const safeScript = (s: string) => s.replace(/<\/script/gi, "<\\/script");
const safeStyle = (s: string) => s.replace(/<\/style/gi, "<\\/style");

export const FRAMEWORK_PATH = `/framework/${FRAMEWORK_VERSION}/${FRAMEWORK_FILE}`;

export const FRAMEWORK_HEADERS = {
  "content-type": "text/css; charset=utf-8",
  "cache-control": "public, max-age=31536000, immutable",
};

const frameworkCache = new Map<string, string>();
/** The vendored framework plus Slate's adapter, served at FRAMEWORK_PATH. */
export function frameworkStylesheet(dir: string): string {
  let css = frameworkCache.get(dir);
  if (!css) {
    css = readFileSync(join(dir, FRAMEWORK_FILE), "utf8") + ADAPTER_CSS;
    frameworkCache.set(dir, css);
  }
  return css;
}

const csp = (styleOrigin?: string) =>
  [
    "default-src 'none'",
    `style-src 'unsafe-inline'${styleOrigin ? ` ${styleOrigin}` : ""}`,
    "script-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    "connect-src 'none'",
    // Neither falls back to default-src.
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

// The parent display posts theme changes; widgets can't reach the parent otherwise.
const BOOTSTRAP = `window.addEventListener("message",function(e){var d=e.data;if(d&&d.type==="slate:theme"){document.documentElement.dataset.theme=d.theme}});`;

export interface FrameworkOptions {
  /** Origin the srcdoc frame loads the framework stylesheet from, e.g. `http://10.0.0.5:8787`. */
  origin: string;
  layout: LayoutName;
  scale: number;
}

export function wrapDocument(opts: {
  body: string;
  theme: string;
  style?: string;
  scripts?: string[];
  title: string;
  framework?: FrameworkOptions;
}) {
  const scripts = [BOOTSTRAP, ...(opts.scripts ?? [])]
    .map((s) => `<script>${safeScript(s)}</script>`)
    .join("\n");
  const fw = opts.framework;
  const head = `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp(fw?.origin)}">
<title>${escapeHtml(opts.title)}</title>`;
  if (fw) {
    return `<!doctype html>
<html class="trmnl" data-theme="${escapeHtml(opts.theme)}"><head>${head}
<link rel="stylesheet" href="${escapeHtml(fw.origin + FRAMEWORK_PATH)}">
<style>${themeCss()}${safeStyle(opts.style ?? "")}</style>
${scripts}
</head><body><div class="screen" style="--device-ui-scale:${fw.scale}"><div class="view view--${fw.layout}">${opts.body}</div></div></body></html>`;
  }
  return `<!doctype html>
<html data-theme="${escapeHtml(opts.theme)}"><head>${head}
<style>${themeCss()}${BASE_CSS}${safeStyle(opts.style ?? "")}</style>
${scripts}
</head><body><div class="view">${opts.body}</div></body></html>`;
}

export interface RenderCellOptions {
  registry: Registry;
  config: SlateConfig;
  grid: GridLayout;
  item: GridItem;
  bindings: Record<string, BindingState>;
  theme: string;
  timezone?: string;
  now?: () => Date;
  /** Display size in CSS pixels, used to scale TRMNL Framework widgets to their slot. */
  displaySize?: { width: number; height: number };
  /** Origin displays reach this server at; required for TRMNL Framework widgets. */
  assetOrigin?: string;
}

export async function renderCell(opts: RenderCellOptions): Promise<RenderedCell> {
  const { registry, config, grid, item } = opts;
  const inst = config.instances[item.instance];
  const widget = inst && registry.widgets.get(inst.widget);
  if (!inst || !widget) {
    const html = wrapDocument({
      title: item.instance,
      theme: opts.theme,
      body: `<div class="layout layout--center"><span class="label">Missing widget "${escapeHtml(inst?.widget ?? item.instance)}"</span></div>`,
    });
    return { ...item, widget: inst?.widget ?? "", layout: "full", html };
  }
  const layout = pickTemplate(item, grid, widget.layouts, widget.templateRules);
  const settings = Object.fromEntries(
    (widget.fields ?? []).map((f) => [f.keyname, inst.settings[f.keyname] ?? f.default]),
  );
  Object.assign(settings, inst.settings);
  const data: Record<string, unknown> = {};
  const meta: Record<string, unknown> = {};
  for (const [alias, b] of Object.entries(opts.bindings)) {
    data[alias] = b.data;
    meta[alias] = {
      fetchedAt: b.fetchedAt,
      stale: b.stale,
      error: b.error,
      unconfigured: b.unconfigured,
    };
  }
  const timezone = opts.timezone ?? config.location?.timezone;
  const context = {
    settings,
    data,
    meta,
    location: config.location,
    units: config.units,
    instance: { id: item.instance, name: inst.name ?? widget.name },
    slot: { w: item.w, h: item.h, cols: grid.cols, rows: grid.rows, layout },
    trmnl: {
      plugin_settings: { instance_name: inst.name ?? widget.name, custom_fields_values: settings },
      user: { time_zone: timezone ?? "", locale: "en" },
    },
  };
  const extensions = (widget.extensionPoints ?? []).flatMap((p) => registry.extensionsFor(p));
  const partials = Object.fromEntries(
    extensions.filter((e) => e.template).map((e) => [`${e.point}/${e.id}`, e.template!]),
  );
  let body: string;
  try {
    body = await renderTrmnl(widget.templates[layout]!, context, {
      shared: widget.templates.shared,
      partials,
      now: opts.now,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    body = `<div class="layout layout--center"><span class="title">Template error</span><span class="label">${escapeHtml(msg)}</span></div>`;
  }
  const display = opts.displaySize ?? { width: 1440, height: 960 };
  const framework =
    widget.framework === "trmnl" && opts.assetOrigin
      ? {
          origin: opts.assetOrigin,
          layout,
          scale: frameworkScale(layout, {
            w: (item.w / grid.cols) * display.width,
            h: (item.h / grid.rows) * display.height,
          }),
        }
      : undefined;
  const html = wrapDocument({
    title: inst.name ?? widget.name,
    theme: opts.theme,
    framework,
    body,
    style: [widget.style, ...extensions.map((e) => e.style)].filter(Boolean).join("\n"),
    scripts: [widget.client, ...extensions.map((e) => e.client)].filter((s): s is string =>
      Boolean(s),
    ),
  });
  return { ...item, widget: widget.id, layout, html };
}
