import { existsSync, readFileSync, watch } from "node:fs";
import { basename, join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { parseConfig, Registry, type SlateConfig } from "@slate/core";
import { loadPlugin, loadPlugins } from "@slate/core/node";
import { LAYOUTS, type FetchLike, type LayoutName } from "@slate/sdk";
import { fixtureFetch } from "@slate/sdk/testing";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { frameworkDir } from "./paths.ts";
import { FRAMEWORK_HEADERS, FRAMEWORK_PATH, frameworkStylesheet, renderCell } from "./render.ts";
import { ConnectorRuntime } from "./runtime.ts";

export interface DevOptions {
  /** A plugin folder, or a folder of plugins. */
  dir: string;
  port?: number;
  location?: { lat: number; lon: number; name?: string; timezone?: string };
  units?: SlateConfig["units"];
  theme?: string;
  /** `origin+pathname` → JSON file; matching connector requests are answered from it. */
  fixtures?: Record<string, string>;
  fetch?: FetchLike;
}

/** Surface Pro X at CSS 1440x960 and the TRMNL OG at 800x480. */
export const DEVICES = [
  { id: "surface", name: "Surface Pro X (1440×960)", width: 1440, height: 960 },
  { id: "trmnl", name: "TRMNL OG (800×480)", width: 800, height: 480 },
] as const;

// Each layout as a slot of a 2x2 grid; pickTemplate maps these shapes to the same names.
const SLOTS: Record<LayoutName, { w: number; h: number }> = {
  full: { w: 2, h: 2 },
  half_horizontal: { w: 2, h: 1 },
  half_vertical: { w: 1, h: 2 },
  quadrant: { w: 1, h: 1 },
};

const isPluginDir = (dir: string) =>
  ["settings.yml", "connector.ts", "connector.mjs", "connector.js", "extensions", "widgets"].some(
    (f) => existsSync(join(dir, f)),
  );

export async function loadDevRegistry(dir: string, cacheBust?: string) {
  const opts = { preferSource: true, cacheBust };
  if (!isPluginDir(dir)) return loadPlugins([dir], opts);
  const registry = new Registry();
  try {
    await loadPlugin(dir, registry, opts);
    return { registry, errors: [] };
  } catch (err) {
    return { registry, errors: [{ dir, error: err instanceof Error ? err.message : String(err) }] };
  }
}

export function devConfig(registry: Registry, opts: DevOptions): SlateConfig {
  return parseConfig({
    location: opts.location ? { name: "", ...opts.location } : null,
    units: opts.units,
    instances: Object.fromEntries(
      [...registry.widgets.values()].map((w) => [`w-${w.id}`, { widget: w.id }]),
    ),
  });
}

/** Renders every widget in every layout at both device sizes. */
export async function renderPreview(
  registry: Registry,
  config: SlateConfig,
  runtime: ConnectorRuntime,
  opts: { theme?: string; assetOrigin: string },
) {
  const widgets = [];
  for (const [instance, inst] of Object.entries(config.instances)) {
    const widget = registry.widgets.get(inst.widget)!;
    const frames = [];
    for (const device of DEVICES) {
      for (const layout of LAYOUTS) {
        const slot = SLOTS[layout];
        const grid = { cols: 2, rows: 2, items: [] };
        const cell = await renderCell({
          registry,
          config,
          grid,
          item: { instance, x: 0, y: 0, ...slot },
          bindings: runtime.bindingsFor(instance),
          theme: opts.theme ?? "paper",
          timezone: config.location?.timezone,
          displaySize: device,
          assetOrigin: opts.assetOrigin,
        });
        frames.push({
          device: device.id,
          layout,
          rendered: cell.layout,
          width: (device.width * slot.w) / 2,
          height: (device.height * slot.h) / 2,
          html: cell.html,
        });
      }
    }
    widgets.push({ id: widget.id, name: widget.name, frames });
  }
  return widgets;
}

/** `slate dev`: a live preview of a plugin's widgets that reloads when its files change. */
export async function startDev(opts: DevOptions) {
  const dir = resolve(opts.dir);
  if (!existsSync(dir)) throw new Error(`No such folder: ${dir}`);
  const port = opts.port ?? 8788;
  const fixtures = Object.fromEntries(
    Object.entries(opts.fixtures ?? {}).map(([url, file]) => [
      url,
      JSON.parse(readFileSync(resolve(file), "utf8")) as unknown,
    ]),
  );
  const answer = fixtureFetch(fixtures);
  const fetchImpl: FetchLike = (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    return url.origin + url.pathname in fixtures
      ? answer(input)
      : (opts.fetch ?? fetch)(input, init);
  };

  let generation = 0;
  let state = await load();
  async function load() {
    const { registry, errors } = await loadDevRegistry(dir, String(generation));
    const config = devConfig(registry, opts);
    const runtime = new ConnectorRuntime(registry, config, { fetch: fetchImpl });
    await runtime.tick();
    return { registry, errors, config, runtime };
  }

  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(dir, { recursive: true }, (_event, file) => {
    if (file && /node_modules|\.git|connector\.mjs$/.test(String(file))) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      generation++;
      state = await load();
      console.log(`[slate dev] reloaded (${file ?? "change"})`);
      notify();
    }, 150);
  });
  const poll = setInterval(async () => {
    const before = JSON.stringify(state.runtime.health());
    await state.runtime.tick();
    if (JSON.stringify(state.runtime.health()) !== before) notify();
  }, 5_000);

  const app = new Hono();
  app.get("/", (c) => c.html(previewHtml(basename(dir))));
  app.get("/preview.json", async (c) =>
    c.json({
      errors: state.errors,
      widgets: await renderPreview(state.registry, state.config, state.runtime, {
        theme: c.req.query("theme") ?? opts.theme,
        assetOrigin: new URL(c.req.url).origin,
      }),
    }),
  );
  app.get(FRAMEWORK_PATH, (c) =>
    c.body(frameworkStylesheet(frameworkDir()), 200, FRAMEWORK_HEADERS),
  );
  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const send = () => void stream.writeSSE({ event: "reload", data: String(generation) });
      listeners.add(send);
      stream.onAbort(() => {
        listeners.delete(send);
      });
      while (!stream.aborted) await stream.sleep(15_000);
      listeners.delete(send);
    }),
  );

  const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
    console.log(`[slate dev] previewing ${dir}`);
    console.log(`[slate dev] open http://localhost:${port}`);
    for (const e of state.errors) console.error(`[slate dev] ${e.dir}: ${e.error}`);
  });
  return {
    app,
    close() {
      watcher.close();
      clearInterval(poll);
      server.close();
    },
  };
}

function previewHtml(title: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>slate dev: ${title.replace(/[<>&"]/g, "")}</title>
<style>
body{margin:0;font:14px/1.4 system-ui,sans-serif;background:#d9d6cc;color:#1b1a17}
header{position:sticky;top:0;background:#1b1a17;color:#f4f2ec;padding:8px 16px;display:flex;gap:16px;align-items:center;z-index:1}
header select{font:inherit}
main{padding:16px}
h2{margin:24px 0 8px}h3{margin:12px 0 6px;font-size:13px;color:#555}
.row{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
figure{margin:0}figcaption{font-size:12px;color:#555;margin-bottom:4px}
.frame{overflow:hidden;box-shadow:0 1px 4px #0003;background:#fff}
.frame iframe{border:0;transform-origin:0 0;display:block}
.err{background:#fbe3df;border:1px solid #b3261e;padding:8px 12px;border-radius:6px;margin:8px 0;white-space:pre-wrap}
</style></head><body>
<header><strong>slate dev</strong><span>${title.replace(/[<>&"]/g, "")}</span>
<label>Theme <select id="theme"><option>paper</option><option>ink-dark</option></select></label>
<span id="status"></span></header>
<main id="root"></main>
<script>
const SCALE = { surface: 0.4, trmnl: 0.6 };
const root = document.getElementById("root");
async function render() {
  const res = await fetch("/preview.json?theme=" + document.getElementById("theme").value);
  const { errors, widgets } = await res.json();
  root.replaceChildren();
  for (const e of errors) { const d = document.createElement("div"); d.className = "err"; d.textContent = e.dir + ": " + e.error; root.append(d); }
  for (const w of widgets) {
    const h = document.createElement("h2"); h.textContent = w.name + " (" + w.id + ")"; root.append(h);
    for (const device of ["surface", "trmnl"]) {
      const h3 = document.createElement("h3"); h3.textContent = device === "surface" ? "Surface Pro X, 1440×960" : "TRMNL OG, 800×480"; root.append(h3);
      const row = document.createElement("div"); row.className = "row";
      for (const f of w.frames.filter((f) => f.device === device)) {
        const s = SCALE[device];
        const fig = document.createElement("figure"); fig.dataset.layout = f.layout; fig.dataset.device = device;
        const cap = document.createElement("figcaption"); cap.textContent = f.layout + (f.rendered !== f.layout ? " (falls back to " + f.rendered + ")" : "") + " · " + f.width + "×" + f.height;
        const box = document.createElement("div"); box.className = "frame"; box.style.width = f.width * s + "px"; box.style.height = f.height * s + "px";
        const frame = document.createElement("iframe"); frame.setAttribute("sandbox", "allow-scripts"); frame.width = f.width; frame.height = f.height;
        frame.style.transform = "scale(" + s + ")"; frame.srcdoc = f.html;
        box.append(frame); fig.append(cap, box); row.append(fig);
      }
      root.append(row);
    }
  }
  document.getElementById("status").textContent = "updated " + new Date().toLocaleTimeString();
}
document.getElementById("theme").onchange = render;
new EventSource("/events").addEventListener("reload", render);
render();
</script></body></html>`;
}

/** `slate dev` resolves a bare plugin name against ./plugins for convenience in this repo. */
export function resolvePluginDir(arg: string | undefined, cwd = process.cwd()): string {
  if (!arg) return cwd;
  const direct = resolve(cwd, arg);
  if (existsSync(direct)) return direct;
  const inRepo = join(cwd, "plugins", arg);
  return existsSync(inRepo) ? inRepo : direct;
}
