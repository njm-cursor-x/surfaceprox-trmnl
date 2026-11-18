import { EventEmitter } from "node:events";
import {
  ConnectorCache,
  connectorKey,
  QuotaTracker,
  resolveBinding,
  stableStringify,
  type Registry,
  type SlateConfig,
} from "@slate/core";
import { createScopedFetch, type Connector, type FetchLike } from "@slate/sdk";

export interface BindingState {
  key?: string;
  connector: string;
  data?: unknown;
  fetchedAt?: number;
  stale: boolean;
  error?: string;
  /** Required inputs (e.g. location) are missing, so nothing is fetched. */
  unconfigured?: boolean;
}

interface ActiveKey {
  connector: Connector;
  config: unknown;
}

export interface RuntimeOptions {
  fetch?: FetchLike;
  now?: () => number;
  tickMs?: number;
  timeoutMs?: number;
}

/**
 * Runs connectors for widget instances: resolves bindings, shares one fetch per
 * (connector, config), respects per-connector quotas, and emits `change` on new data.
 */
export class ConnectorRuntime extends EventEmitter<{ change: [string] }> {
  readonly cache = new ConnectorCache();
  private quotas = new Map<string, QuotaTracker>();
  private active = new Map<string, ActiveKey>();
  private timer?: NodeJS.Timeout;
  private readonly baseFetch: FetchLike;
  private readonly now: () => number;

  constructor(
    private registry: Registry,
    private config: SlateConfig,
    private opts: RuntimeOptions = {},
  ) {
    super();
    this.baseFetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.recompute();
  }

  setConfig(config: SlateConfig): void {
    this.config = config;
    this.recompute();
    void this.tick();
  }

  /** Data and status for each connector alias a widget instance binds. */
  bindingsFor(instanceId: string): Record<string, BindingState> {
    const inst = this.config.instances[instanceId];
    const widget = inst && this.registry.widgets.get(inst.widget);
    if (!inst || !widget) return {};
    const out: Record<string, BindingState> = {};
    for (const [alias, binding] of Object.entries(widget.connectors ?? {})) {
      const resolved = this.resolve(instanceId, alias);
      if (!resolved.ok) {
        out[alias] = {
          connector: binding.use,
          stale: true,
          unconfigured: resolved.unconfigured,
          error: resolved.error,
        };
        continue;
      }
      const read = this.cache.read(resolved.key, resolved.connector.refreshMs, this.now());
      out[alias] = { key: resolved.key, connector: binding.use, ...read };
    }
    return out;
  }

  health() {
    return [...this.active.entries()].map(([key, { connector }]) => {
      const read = this.cache.read(key, connector.refreshMs, this.now());
      return {
        key,
        connector: connector.id,
        fetchedAt: read.fetchedAt ?? null,
        stale: read.stale,
        error: read.error ?? null,
        quota: this.quota(connector).usage(this.now()),
      };
    });
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.opts.tickMs ?? 5_000);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Refreshes every active key that is stale and within quota. */
  async tick(): Promise<void> {
    const now = this.now();
    const due = [...this.active.entries()].filter(([key, { connector }]) => {
      const read = this.cache.read(key, connector.refreshMs, now);
      if (read.fetchedAt === undefined && read.errorAt === undefined) return true;
      const lastAttempt = Math.max(read.fetchedAt ?? -Infinity, read.errorAt ?? -Infinity);
      return read.stale && now - lastAttempt >= connector.minRefreshMs;
    });
    await Promise.all(due.map(([key, entry]) => this.refresh(key, entry)));
  }

  private async refresh(key: string, { connector, config }: ActiveKey): Promise<void> {
    const quota = this.quota(connector);
    if (!quota.tryAcquire(this.now()).ok) return;
    const before = this.cache.read(key, Infinity);
    const after = await this.cache.refresh(key, () => this.run(connector, config, quota), this.now);
    if (after.data !== undefined) quota.succeeded();
    if (
      stableStringify(before.data) !== stableStringify(after.data) ||
      before.error !== after.error
    ) {
      this.emit("change", key);
    }
  }

  private async run(connector: Connector, config: unknown, quota: QuotaTracker): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 20_000);
    const watched: FetchLike = async (input, init) => {
      const res = await this.baseFetch(input, init);
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get("retry-after"));
        quota.rateLimited(
          this.now(),
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        );
      }
      return res;
    };
    try {
      return await connector.fetch({
        config,
        secrets: {},
        fetch: createScopedFetch(connector.hosts, watched),
        signal: controller.signal,
        now: () => new Date(this.now()),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private quota(connector: Connector): QuotaTracker {
    let q = this.quotas.get(connector.id);
    if (!q) {
      q = new QuotaTracker(connector.quota);
      this.quotas.set(connector.id, q);
    }
    return q;
  }

  private resolve(
    instanceId: string,
    alias: string,
  ):
    | { ok: true; key: string; connector: Connector; config: unknown }
    | { ok: false; unconfigured: boolean; error: string } {
    const inst = this.config.instances[instanceId]!;
    const binding = this.registry.widgets.get(inst.widget)!.connectors![alias]!;
    const connector = this.registry.connectors.get(binding.use);
    if (!connector)
      return {
        ok: false,
        unconfigured: false,
        error: `Connector "${binding.use}" is not installed`,
      };
    const scope = {
      settings: inst.settings,
      location: this.config.location,
      units: this.config.units,
    };
    const raw = resolveBinding(binding.with, scope);
    const parsed = connector.config.safeParse(
      Object.fromEntries(
        Object.entries(raw).filter(([, v]) => v !== undefined && v !== null && v !== ""),
      ),
    );
    if (!parsed.success) {
      return {
        ok: false,
        unconfigured: true,
        error: parsed.error.issues.map((i) => i.path.join(".")).join(", "),
      };
    }
    return {
      ok: true,
      key: connectorKey(connector.id, parsed.data),
      connector,
      config: parsed.data,
    };
  }

  private recompute(): void {
    const next = new Map<string, ActiveKey>();
    for (const [instanceId, inst] of Object.entries(this.config.instances)) {
      const widget = this.registry.widgets.get(inst.widget);
      for (const alias of Object.keys(widget?.connectors ?? {})) {
        const r = this.resolve(instanceId, alias);
        if (r.ok) next.set(r.key, { connector: r.connector, config: r.config });
      }
    }
    this.active = next;
  }
}
