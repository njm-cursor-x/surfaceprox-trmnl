import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import {
  ConfigSchema,
  LAYOUT_TEMPLATES,
  referenceIssues,
  validateLayout,
  type ConfigIssue,
  type Registry,
  type SlateConfig,
} from "@slate/core";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { parse as parseYaml } from "yaml";
import {
  LoginLimiter,
  MIN_PASSWORD,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  type AuthStore,
} from "./auth.ts";
import { configUiHtml } from "./config-ui.ts";
import { lanGuard, parseAllowedHosts } from "./guard.ts";
import { lanUrls } from "./net.ts";
import { qrSvg } from "./qr.ts";
import { FRAMEWORK_HEADERS, FRAMEWORK_PATH, frameworkStylesheet, renderCell } from "./render.ts";
import type { ConnectorRuntime } from "./runtime.ts";
import { applyStarter, newDisplay, STARTERS } from "./starters.ts";
import type { ConfigStore } from "./store.ts";
import { THEMES } from "./themes.ts";
import { wizardHtml } from "./wizard-ui.ts";

export interface AppDeps {
  store: ConfigStore;
  auth: AuthStore;
  registry: Registry;
  runtime: ConnectorRuntime;
  displayDir: string;
  frameworkDir: string;
  loadErrors?: { dir: string; error: string }[];
  pingMs?: number;
  geocodeFetch?: typeof fetch;
  /** Extra Host names (e.g. a reverse-proxy domain); defaults to `SLATE_ALLOWED_HOSTS`. */
  allowedHosts?: string[];
  port?: number;
  /** Peer address of a request; node-server exposes it on `c.env.incoming`. */
  clientAddress?: (c: Context) => string | undefined;
}

type NodeEnv = { incoming?: { socket?: { remoteAddress?: string } } };
const nodeClientAddress = (c: Context) =>
  (c.env as NodeEnv | undefined)?.incoming?.socket?.remoteAddress;

const LOOPBACK_ADDR = /^(127\.|::1$|::ffff:127\.)/;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** Public: the display endpoints carry their own token; these are needed to sign in. */
const PUBLIC_API = new Set(["/api/session", "/api/login", "/api/logout", "/api/setup/admin"]);

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

  app.use(lanGuard(deps.allowedHosts ?? parseAllowedHosts(process.env.SLATE_ALLOWED_HOSTS)));
  app.on(
    ["PUT", "POST"],
    "/api/*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ ok: false, error: "Request body too large" }, 413),
    }),
  );

  const { auth } = deps;
  const limiter = new LoginLimiter();
  const clientAddress = deps.clientAddress ?? nodeClientAddress;
  const clientKey = (c: Context) => clientAddress(c) ?? "unknown";
  /**
   * Same machine, by peer address *and* Host header: the Host check stops a DNS-rebound
   * page in the kiosk browser from passing as local.
   */
  const isLocal = (c: Context) =>
    LOOPBACK_ADDR.test(clientAddress(c) ?? "") && LOOPBACK_HOST.test(c.req.header("host") ?? "");
  const authenticated = (c: Context) => auth.verifySession(getCookie(c, SESSION_COOKIE));
  const startSession = (c: Context) =>
    setCookie(c, SESSION_COOKIE, auth.issueSession(), {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: SESSION_MAX_AGE_S,
    });

  const requireAdmin: MiddlewareHandler = async (c, next) => {
    if (PUBLIC_API.has(c.req.path) || c.req.path.startsWith("/api/display/")) return next();
    if (!authenticated(c)) {
      return c.json(
        { ok: false, error: auth.hasAdmin() ? "Sign in required" : "Finish setup first" },
        401,
      );
    }
    await next();
  };
  app.use("/api/*", requireAdmin);

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

  const readJson = async (c: Context) =>
    requireType(c, ["application/json"])
      ? ((await c.req.json().catch(() => null)) as Record<string, unknown> | null)
      : undefined;

  app.get("/api/session", (c) => {
    const ok = authenticated(c);
    return c.json({
      authenticated: ok,
      hasAdmin: auth.hasAdmin(),
      setupComplete: auth.setupComplete,
      needsCode: !auth.hasAdmin() && !isLocal(c),
      minPassword: MIN_PASSWORD,
      ...(ok ? { lanUrls: lanUrls(deps.port ?? 8787) } : {}),
    });
  });

  app.post("/api/setup/admin", async (c) => {
    const body = await readJson(c);
    if (body === undefined) return c.json({ ok: false, error: "Expected application/json" }, 415);
    if (auth.hasAdmin())
      return c.json({ ok: false, error: "Setup is already done. Sign in instead." }, 409);
    const key = clientKey(c);
    if (limiter.blocked(key))
      return c.json({ ok: false, error: "Too many attempts. Wait a few minutes." }, 429);
    if (!isLocal(c) && !auth.checkSetupCode(body?.code)) {
      limiter.fail(key);
      return c.json({ ok: false, error: "That setup code doesn't match." }, 403);
    }
    const password = body?.password;
    if (typeof password !== "string" || password.length < MIN_PASSWORD) {
      return c.json(
        { ok: false, error: `Use a password of at least ${MIN_PASSWORD} characters.` },
        400,
      );
    }
    auth.createAdmin(password);
    limiter.reset(key);
    startSession(c);
    return c.json({ ok: true });
  });

  app.post("/api/login", async (c) => {
    const body = await readJson(c);
    if (body === undefined) return c.json({ ok: false, error: "Expected application/json" }, 415);
    const key = clientKey(c);
    if (limiter.blocked(key))
      return c.json({ ok: false, error: "Too many attempts. Wait a few minutes." }, 429);
    if (!auth.verifyPassword(body?.password)) {
      limiter.fail(key);
      return c.json({ ok: false, error: "Wrong password." }, 401);
    }
    limiter.reset(key);
    startSession(c);
    return c.json({ ok: true });
  });

  app.post("/api/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.post("/api/password", async (c) => {
    const body = await readJson(c);
    if (body === undefined) return c.json({ ok: false, error: "Expected application/json" }, 415);
    if (!auth.verifyPassword(body?.current))
      return c.json({ ok: false, error: "Current password is wrong." }, 403);
    try {
      auth.setPassword(String(body?.next ?? ""));
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 400);
    }
    startSession(c);
    return c.json({ ok: true });
  });

  app.get("/api/starters", (c) =>
    c.json({
      starters: STARTERS.map(({ id, name, description, layout, instances }) => ({
        id,
        name,
        description,
        layout,
        widgets: instances.map((i) => i.name ?? registry.widgets.get(i.widget)?.name ?? i.widget),
      })),
      templates: LAYOUT_TEMPLATES,
    }),
  );

  app.post("/api/setup/starter", async (c) => {
    const body = await readJson(c);
    if (body === undefined) return c.json({ ok: false, error: "Expected application/json" }, 415);
    let next: SlateConfig;
    try {
      next = applyStarter(store.get(), String(body?.starter ?? ""));
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 400);
    }
    return save(c, next);
  });

  app.post("/api/displays", async (c) => {
    const body = await readJson(c);
    if (body === undefined) return c.json({ ok: false, error: "Expected application/json" }, 415);
    const config = store.get();
    const playlist = Object.keys(config.playlists)[0];
    if (!playlist) return c.json({ ok: false, error: "Add a screen first." }, 400);
    const name =
      String(body?.name ?? "")
        .trim()
        .slice(0, 60) || "New display";
    let n = Object.keys(config.displays).length + 1;
    while (config.displays[`display-${n}`]) n++;
    const id = `display-${n}`;
    const res = save(c, {
      ...config,
      displays: { ...config.displays, [id]: newDisplay(playlist, name) },
    });
    return res.status === 200 ? c.json({ ok: true, id, config: store.get() }) : res;
  });

  app.get("/api/qr.svg", (c) => {
    const text = c.req.query("text") ?? "";
    if (!text || text.length > 1024) return c.text("Expected ?text= up to 1024 characters", 400);
    return c.body(qrSvg(text), 200, {
      "content-type": "image/svg+xml",
      "cache-control": "private, max-age=3600",
    });
  });

  app.post("/api/setup/complete", (c) => {
    auth.completeSetup();
    return c.json({ ok: true });
  });

  app.get(FRAMEWORK_PATH, (c) =>
    c.body(frameworkStylesheet(deps.frameworkDir), 200, FRAMEWORK_HEADERS),
  );

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
            displaySize: { width: display.width, height: display.height },
            assetOrigin: new URL(c.req.url).origin,
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

  app.get("/setup", (c) => c.html(wizardHtml()));
  app.get("/", (c) => (auth.hasAdmin() ? c.html(configUiHtml()) : c.redirect("/setup")));

  return {
    app,
    bump,
    get version() {
      return version;
    },
  };
}
