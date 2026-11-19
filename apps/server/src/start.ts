import { join } from "node:path";
import { serve } from "@hono/node-server";
import { lanUrls } from "./net.ts";
import { defaultDataDir, repoRoot } from "./paths.ts";
import { qrTerminal } from "./qr.ts";
import { createSlate } from "./server.ts";

export interface StartOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  /** Running from TypeScript source: keep data in the repo and prefer connector.ts. */
  dev?: boolean;
}

export function resolveStart(opts: StartOptions = {}, env = process.env) {
  const port = opts.port ?? Number(env.SLATE_PORT ?? 8787);
  // LAN-only by design: bind all interfaces so phones on the same network can reach the config UI.
  const host = opts.host ?? env.SLATE_HOST ?? "0.0.0.0";
  const dataDir =
    opts.dataDir ??
    (opts.dev && !env.SLATE_DATA_DIR ? join(repoRoot, ".slate-data") : defaultDataDir(env));
  return { port, host, dataDir };
}

/** How to finish first-run setup: on this machine without a code, elsewhere with it. */
export function setupUrls(port: number, code: string | undefined) {
  const local = `http://localhost:${port}/setup`;
  const lan = lanUrls(port).map((u) => `${u}/setup${code ? `?code=${code}` : ""}`);
  return { local, lan };
}

export async function startServer(opts: StartOptions = {}) {
  const { port, host, dataDir } = resolveStart(opts);
  const slate = await createSlate({ dataDir, preferSource: opts.dev, port });
  for (const e of slate.loadErrors)
    console.error(`[slate] plugin failed to load: ${e.dir}: ${e.error}`);
  slate.runtime.start();

  const server = serve({ fetch: slate.app.fetch, port, hostname: host }, () => {
    const lan = lanUrls(port);
    console.log(`[slate] data dir: ${dataDir}`);
    console.log(
      `[slate] config UI: http://localhost:${port}${lan.length ? ` (LAN: ${lan.join(", ")})` : ""}`,
    );
    const code = slate.auth.setupCode;
    if (code) {
      const urls = setupUrls(port, code);
      console.log(`[slate] finish setup in a browser: ${urls.local}`);
      if (urls.lan[0]) {
        console.log(`[slate] or from a phone on this network: ${urls.lan[0]}`);
        console.log(qrTerminal(urls.lan[0]));
      }
      console.log(`[slate] setup code: ${code}`);
    }
  });

  const shutdown = () => {
    slate.runtime.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { slate, server };
}
