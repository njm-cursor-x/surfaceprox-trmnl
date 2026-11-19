// Bundles the `slate` CLI/server into one ESM file (scripts/build-sea.mjs rebundles it
// as CommonJS for the standalone binary) and compiles
// first-party plugin connectors so plain Node can load them without a TS loader.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const pluginsDir = join(here, "..", "..", "plugins");

const banner = {
  js: "import { createRequire as __slateRequire } from 'node:module'; const require = __slateRequire(import.meta.url);",
};

await build({
  entryPoints: [join(here, "src", "bin.ts")],
  outfile: join(here, "dist", "slate.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: `#!/usr/bin/env node\n${banner.js}` },
  logLevel: "info",
});

for (const name of readdirSync(pluginsDir)) {
  const entry = join(pluginsDir, name, "connector.ts");
  if (!existsSync(entry)) continue;
  await build({
    entryPoints: [entry],
    outfile: join(pluginsDir, name, "connector.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner,
    logLevel: "info",
  });
}
