#!/usr/bin/env node
// Copies the runtime files (no node_modules, sources, or tests) into a target dir,
// preserving the layout the server expects. Used by the Dockerfile and install-server.ps1.
//   node scripts/stage.mjs <outDir>
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? join(root, "dist", "slate"));

for (const required of [
  "apps/server/dist/slate.mjs",
  "apps/display/dist/index.html",
  "packages/framework/vendor/trmnl-framework.css",
]) {
  if (!existsSync(join(root, required))) {
    console.error(`Missing ${required}. Run "pnpm build" first.`);
    process.exit(1);
  }
}

const SKIP_DIRS = new Set(["node_modules", "test"]);
const pluginFilter = (src) => {
  const name = basename(src);
  if (SKIP_DIRS.has(name)) return false;
  return !(name.endsWith(".ts") && !name.endsWith(".d.ts"));
};

for (const dir of ["apps/server/dist", "apps/display/dist", "packages/framework/vendor", "plugins"])
  rmSync(join(out, dir), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "apps/server/dist"), join(out, "apps/server/dist"), { recursive: true });
cpSync(join(root, "apps/display/dist"), join(out, "apps/display/dist"), { recursive: true });
cpSync(join(root, "packages/framework/vendor"), join(out, "packages/framework/vendor"), {
  recursive: true,
});
cpSync(join(root, "plugins"), join(out, "plugins"), { recursive: true, filter: pluginFilter });
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));
console.log(`Staged Slate runtime in ${out}`);
