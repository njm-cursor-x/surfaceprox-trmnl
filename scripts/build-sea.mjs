#!/usr/bin/env node
// Builds a standalone `slate` binary for the platform this runs on (Node SEA).
//   pnpm build && node scripts/build-sea.mjs [outDir]
// Output: <outDir>/slate-<os>-<arch>[.exe], os in linux|macos|win, arch in x64|arm64.
// SEA can't cross-build, so CI runs this once per OS/arch runner.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? join(root, "dist", "bin"));
const work = join(root, "dist", "sea-work");
const os = { win32: "win", darwin: "macos", linux: "linux" }[process.platform];
if (!os) throw new Error(`Unsupported platform ${process.platform}`);
const exe = join(out, `slate-${os}-${process.arch}${os === "win" ? ".exe" : ""}`);

for (const required of ["apps/display/dist/index.html", "plugins/weather/connector.mjs"]) {
  if (!existsSync(join(root, required)))
    throw new Error(`Missing ${required}. Run "pnpm build" first.`);
}
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });

// SEA runs a CommonJS script; import.meta.url is rebuilt from the executable path.
await build({
  entryPoints: [join(root, "apps/server/src/bin.ts")],
  outfile: join(work, "slate.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  define: { "import.meta.url": "__slateMetaUrl" },
  banner: { js: 'const __slateMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  logLevel: "warning",
});

const files = {};
const add = (dir, prefix, keep = () => true) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!keep(full)) continue;
    if (statSync(full).isDirectory()) add(full, prefix, keep);
    else
      files[`${prefix}/${relative(baseOf[prefix], full).replaceAll("\\", "/")}`] =
        readFileSync(full).toString("base64");
  }
};
const baseOf = {
  display: join(root, "apps/display/dist"),
  plugins: join(root, "plugins"),
  framework: join(root, "packages/framework/vendor"),
};
add(baseOf.display, "display");
add(baseOf.framework, "framework");
add(baseOf.plugins, "plugins", (p) => {
  const name = basename(p);
  return (
    !["node_modules", "test"].includes(name) && !(name.endsWith(".ts") && !name.endsWith(".d.ts"))
  );
});
const hash = createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 16);
writeFileSync(join(work, "runtime.json"), JSON.stringify({ hash, files }));

writeFileSync(
  join(work, "sea-config.json"),
  JSON.stringify({
    main: join(work, "slate.cjs"),
    output: join(work, "slate.blob"),
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
    assets: { "runtime.json": join(work, "runtime.json") },
  }),
);
execFileSync(process.execPath, ["--experimental-sea-config", join(work, "sea-config.json")], {
  stdio: "inherit",
});

rmSync(exe, { force: true });
copyFileSync(process.execPath, exe);
if (os === "macos") execFileSync("codesign", ["--remove-signature", exe], { stdio: "inherit" });
const postject = join(root, "node_modules", "postject", "dist", "cli.js");
execFileSync(
  process.execPath,
  [
    postject,
    exe,
    "NODE_SEA_BLOB",
    join(work, "slate.blob"),
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ...(os === "macos" ? ["--macho-segment-name", "NODE_SEA"] : []),
  ],
  { stdio: "inherit" },
);
if (os === "macos") execFileSync("codesign", ["--sign", "-", exe], { stdio: "inherit" });

const sha = createHash("sha256").update(readFileSync(exe)).digest("hex");
writeFileSync(`${exe}.sha256`, `${sha}  ${basename(exe)}\n`);
console.log(`Built ${exe} (${(statSync(exe).size / 1e6).toFixed(1)} MB, runtime ${hash})`);
