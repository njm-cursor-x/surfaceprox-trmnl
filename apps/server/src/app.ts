import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import {
  ConfigSchema,
  referenceIssues,
  validateLayout,
  type ConfigIssue,
  type Registry,
  type SlateConfig,
} from "@slate/core";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { parse as parseYaml } from "yaml";
import { configUiHtml } from "./config-ui.ts";
import { renderCell } from "./render.ts";
import type { ConnectorRuntime } from "./runtime.ts";
import type { ConfigStore } from "./store.ts";
import { THEMES } from "./themes.ts";

export interface AppDeps {
  store: ConfigStore;
  registry: Registry;
  runtime: ConnectorRuntime;
  displayDir: string;
  loadErrors?: { dir: string; error: string }[];
  pingMs?: number;
  geocodeFetch?: typeof fetch;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

export function validateConfig(
  input: unknown,
  registry: Registry,
): { config?: SlateConfig; issues: ConfigIssue[] } {
  const parsed = ConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const config = parsed.data;
  const issues = referenceIssues(config, new Set(registry.widgets.keys()));
  for (const [name, screen] of Object.entries(config.screens)) {
    const sizesFor = (instance: string) => {
      const widgetId = config.instances[instance]?.widget;
      return widgetId ? registry.widgets.get(widgetId)?.sizes : undefined;
    };
    for (const issue of validateLayout(screen.grid, sizesFor)) {
      issues.push({ path: `screens.${name}.grid`, message: issue.message });
    }
  }
  return issues.length ? { issues } : { config, issues };
}

export function createApp(deps: AppDeps) {
  const { store, registry, runtime } = deps;
  const app = new Hono();
  const bus = new EventEmitter<{ bump: [number] }>();
  bus.setMaxListeners(0);
  let version = 1;
  const bump = () => bus.emit("bump", ++version);
  store.on("change", (config) => {
    runtime.setConfig(config);
    bump();
  });
  runtime.on("change", bump);

  const displayByToken = (token: string) =>
    Object.entries(store.get().displays).find(([, d]) => d.token === token);

  // Writes need a non-simple content type, so a cross-site page can't submit them without a CORS preflight.
  const requireType = (c: Context, types: string[]) => {
    const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    return types.includes(type);
  };

  const save = (c: Context, input: unknown) => {
    const { config, issues } = validateConfig(input, registry);
    if (!config) return c.json({ ok: false, issues }, 400);
    store.save(config);
    return c.json({ ok: true, config });
  };

  app.get("/healthz", (c) => c.json({ ok: true, version }));

  app.get("/api/health", (c) =>
    c.json({
      version,
      plugins: registry.plugins.map(
        ({ id, name, version: v, widgets, connectors, extensions }) => ({
          id,
          name,
          version: v,
          widgets,
          connectors,
          extensions,
        }),
      ),
      loadErrors: deps.loadErrors ?? [],
      connectors: runtime.health(),
      displaysConnected: bus.listenerCount("bump"),
    }),
  );

  app.get("/api/plugins", (c) =>
    c.json({
      widgets: [...registry.widgets.values()].map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        layouts: w.layouts,
        sizes: w.sizes,
        fields: w.fields ?? [],
        connectors: Object.values(w.connectors ?? {}).map((b) => b.use),
      })),
      connectors: [...registry.connectors.values()].map((k) => ({
        id: k.id,
        name: k.name,
        hosts: k.hosts,
      })),
      extensions: Object.fromEntries(
        [...registry.extensions.entries()].map(([point, m]) => [
          point,
          [...m.values()].map((e) => ({ id: e.id, name: e.name })),
        ]),
      ),
    }),
  );

  app.get("/api/config", (c) => c.json(store.get()));
  app.put("/api/config", async (c) => {
    if (!requireType(c, ["application/json"]))
      return c.json({ ok: false, error: "Expected application/json" }, 415);
    return save(c, await c.req.json().catch(() => null));
  });
  app.get("/api/config.yml", (c) =>
    c.body(store.toYaml(), 200, { "content-type": "text/yaml; charset=utf-8" }),
  );
  app.put("/api/config.yml", async (c) => {
    if (!requireType(c, ["text/yaml", "application/yaml"]))
      return c.json({ ok: false, error: "Expected text/yaml" }, 415);
    let input: unknown;
    try {
      input = parseYaml(await c.req.text());
    } catch (err) {
      return c.json({ ok: false, issues: [{ path: "", message: (err as Error).message }] }, 400);
    }
    return save(c, input);
  });

  app.get("/api/geocode", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2) return c.json({ results: [] });
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({
      name: q,
      count: "8",
      language: "en",
      format: "json",
    }).toString();
    try {
      const res = await (deps.geocodeFetch ?? fetch)(url, { signal: AbortSignal.timeout(8_000) });
      const body = (await res.json()) as { results?: Record<string, unknown>[] };
      return c.json({
        results: (body.results ?? []).map((r) => ({
          name: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
          lat: r.latitude,
          lon: r.longitude,
          timezone: r.timezone,
        })),
      });
    } catch {
      return c.json(
        { results: [], error: "Location search is unavailable; enter coordinates instead." },
        502,
      );
    }
  });

  app.get("/api/display/:token/state", async (c) => {
    const found = displayByToken(c.req.param("token"));
    if (!found) return c.json({ error: "Unknown display" }, 404);
    const [id, display] = found;
    const config = store.get();
    const playlist = config.playlists[display.playlist] ?? { items: [] };
    const timezone = display.timezone ?? config.location?.timezone;
    const screens: Record<string, unknown> = {};
    for (const { screen: screenId } of playlist.items) {
      const screen = config.screens[screenId];
      if (!screen || screens[screenId]) continue;
      const cells = await Promise.all(
        screen.grid.items.map((item) =>
          renderCell({
            registry,
            config,
            grid: screen.grid,
            item,
            bindings: runtime.bindingsFor(item.instance),
            theme: display.theme,
            timezone,
          }),
        ),
      );
      screens[screenId] = {
        name: screen.name ?? screenId,
        cols: screen.grid.cols,
        rows: screen.grid.rows,
        gap: screen.grid.gap,
        cells,
      };
    }
    return c.json({
      version,
      display: { id, ...display, token: undefined, timezone },
      playlist,
      screens,
      themes: Object.keys(THEMES),
    });
  });

  app.get("/api/display/:token/events", (c) => {
    if (!displayByToken(c.req.param("token"))) return c.json({ error: "Unknown display" }, 404);
    return streamSSE(c, async (stream) => {
      const send = (v: number) =>
        stream.writeSSE({ event: "state", data: JSON.stringify({ version: v }) });
      const onBump = (v: number) => void send(v).catch(() => undefined);
      bus.on("bump", onBump);
      stream.onAbort(() => {
        bus.off("bump", onBump);
      });
      await send(version);
      while (!stream.aborted) {
        await stream.sleep(deps.pingMs ?? 15_000);
        if (!stream.aborted) await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      }
      bus.off("bump", onBump);
    });
  });

  const serveDisplayFile = (c: Context, rel: string) => {
    const root = normalize(deps.displayDir + sep);
    const file = normalize(join(root, rel));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile())
      return c.notFound();
    const headers: Record<string, string> = {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
    };
    if (rel.startsWith("assets/")) headers["cache-control"] = "public, max-age=31536000, immutable";
    return c.body(readFileSync(file), 200, headers);
  };

  app.get("/display/*", (c) => serveDisplayFile(c, c.req.path.replace(/^\/display\//, "")));
  app.get("/d/:token", (c) => {
    if (!displayByToken(c.req.param("token"))) return c.text("Unknown display token", 404);
    if (!existsSync(join(deps.displayDir, "index.html"))) {
      return c.text("Display client is not built. Run `pnpm build` first.", 503);
    }
    return serveDisplayFile(c, "index.html");
  });

  app.get("/", (c) => c.html(configUiHtml()));

  return {
    app,
    bump,
    get version() {
      return version;
    },
  };
}
