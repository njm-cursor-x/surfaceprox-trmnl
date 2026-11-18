import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { defaultDataDir, repoRoot } from "./paths.ts";
import { createSlate } from "./server.ts";

const port = Number(process.env.SLATE_PORT ?? 8787);
// LAN-only by design: bind all interfaces so phones on the same network can reach the config UI.
const hostname = process.env.SLATE_HOST ?? "0.0.0.0";
// Running from TypeScript source (tsx) is dev mode: keep data in the repo and let
// plugin connector.ts edits win over built .mjs files.
const dev = import.meta.url.endsWith(".ts");
const dataDir =
  dev && !process.env.SLATE_DATA_DIR ? join(repoRoot, ".slate-data") : defaultDataDir();

const slate = await createSlate({ dataDir, preferSource: dev });
for (const e of slate.loadErrors)
  console.error(`[slate] plugin failed to load: ${e.dir}: ${e.error}`);
slate.runtime.start();

const server = serve({ fetch: slate.app.fetch, port, hostname }, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i!.address}:${port}`);
  const display = Object.values(slate.store.get().displays)[0];
  console.log(`[slate] data dir: ${dataDir}`);
  console.log(
    `[slate] config UI: http://localhost:${port}${lan.length ? ` (LAN: ${lan.join(", ")})` : ""}`,
  );
  if (display) console.log(`[slate] display URL: http://localhost:${port}/d/${display.token}`);
});

const shutdown = () => {
  slate.runtime.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
