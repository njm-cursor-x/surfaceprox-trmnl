import { join } from "node:path";
import type { SlateConfig } from "@slate/core";
import { loadPlugins } from "@slate/core/node";
import type { FetchLike } from "@slate/sdk";
import { createApp, type AppDeps } from "./app.ts";
import { AuthStore } from "./auth.ts";
import { bundledPluginsDir, displayDistDir, frameworkDir } from "./paths.ts";
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
  port?: number;
  clientAddress?: AppDeps["clientAddress"];
}

/** Wires plugins, config store, connector runtime, and HTTP app. */
export async function createSlate(opts: SlateServerOptions) {
  const pluginDirs = opts.pluginDirs ?? [bundledPluginsDir(), join(opts.dataDir, "plugins")];
  const { registry, errors } = await loadPlugins(pluginDirs, { preferSource: opts.preferSource });
  const store = new ConfigStore(opts.dataDir, opts.initialConfig);
  const auth = new AuthStore(opts.dataDir);
  const runtime = new ConnectorRuntime(registry, store.get(), {
    fetch: opts.fetch,
    tickMs: opts.tickMs,
  });
  const { app } = createApp({
    store,
    auth,
    registry,
    runtime,
    displayDir: opts.displayDir ?? displayDistDir(),
    frameworkDir: frameworkDir(),
    loadErrors: errors,
    pingMs: opts.pingMs,
    allowedHosts: opts.allowedHosts,
    geocodeFetch: opts.fetch as typeof fetch | undefined,
    port: opts.port,
    clientAddress: opts.clientAddress,
  });
  return { app, store, auth, registry, runtime, loadErrors: errors };
}
