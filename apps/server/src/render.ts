import {
  pickTemplate,
  type GridItem,
  type GridLayout,
  type Registry,
  type SlateConfig,
} from "@slate/core";
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

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
].join("; ");

// The parent display posts theme changes; widgets can't reach the parent otherwise.
const BOOTSTRAP = `window.addEventListener("message",function(e){var d=e.data;if(d&&d.type==="slate:theme"){document.documentElement.dataset.theme=d.theme}});`;

export function wrapDocument(opts: {
  body: string;
  theme: string;
  style?: string;
  scripts?: string[];
  title: string;
}) {
  const scripts = [BOOTSTRAP, ...(opts.scripts ?? [])]
    .map((s) => `<script>${safeScript(s)}</script>`)
    .join("\n");
  return `<!doctype html>
<html data-theme="${escapeHtml(opts.theme)}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${escapeHtml(opts.title)}</title>
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
  const html = wrapDocument({
    title: inst.name ?? widget.name,
    theme: opts.theme,
    body,
    style: [widget.style, ...extensions.map((e) => e.style)].filter(Boolean).join("\n"),
    scripts: [widget.client, ...extensions.map((e) => e.client)].filter((s): s is string =>
      Boolean(s),
    ),
  });
  return { ...item, widget: widget.id, layout, html };
}
