import { join } from "node:path";
import type { SlateConfig } from "@slate/core";
import { loadPlugins } from "@slate/core/node";
import type { FetchLike } from "@slate/sdk";
import { createApp } from "./app.ts";
import { bundledPluginsDir, displayDistDir } from "./paths.ts";
import { ConnectorRuntime } from "./runtime.ts";
import { ConfigStore } from "./store.ts";

export interface SlateServerOptions {
  dataDir: string;
  pluginDirs?: string[];
  displayDir?: string;
  initialConfig?: SlateConfig;
  preferSource?: boolean;
  fetch?: FetchLike;
  tickMs?: number;
  pingMs?: number;
  allowedHosts?: string[];
}

/** Wires plugins, config store, connector runtime, and HTTP app. */
export async function createSlate(opts: SlateServerOptions) {
  const pluginDirs = opts.pluginDirs ?? [bundledPluginsDir(), join(opts.dataDir, "plugins")];
  const { registry, errors } = await loadPlugins(pluginDirs, { preferSource: opts.preferSource });
  const store = new ConfigStore(opts.dataDir, opts.initialConfig);
  const runtime = new ConnectorRuntime(registry, store.get(), {
    fetch: opts.fetch,
    tickMs: opts.tickMs,
  });
  const { app } = createApp({
    store,
    registry,
    runtime,
    displayDir: opts.displayDir ?? displayDistDir(),
    loadErrors: errors,
    pingMs: opts.pingMs,
    allowedHosts: opts.allowedHosts,
  });
  return { app, store, registry, runtime, loadErrors: errors };
}
