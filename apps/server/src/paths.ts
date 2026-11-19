import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Platform data directory; `SLATE_DATA_DIR` wins (Docker sets `/data`). */
export function defaultDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string {
  if (env.SLATE_DATA_DIR) return resolve(env.SLATE_DATA_DIR);
  if (platform === "win32") return join(env.ProgramData ?? "C:\\ProgramData", "slate");
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "slate");
  return join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "slate");
}

// Same relative layout from apps/server/src (dev) and apps/server/dist (built, Docker, Node install).
const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..", "..");

export function bundledPluginsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SLATE_PLUGINS_DIR ? resolve(env.SLATE_PLUGINS_DIR) : join(repoRoot, "plugins");
}

export function displayDistDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SLATE_DISPLAY_DIR
    ? resolve(env.SLATE_DISPLAY_DIR)
    : join(repoRoot, "apps", "display", "dist");
}

export function frameworkDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SLATE_FRAMEWORK_DIR
    ? resolve(env.SLATE_FRAMEWORK_DIR)
    : join(repoRoot, "packages", "framework", "vendor");
}
