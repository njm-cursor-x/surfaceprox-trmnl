import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Asset name of the packed runtime (display client, plugins, framework CSS) in the SEA blob. */
export const RUNTIME_ASSET = "runtime.json";

export interface RuntimePack {
  hash: string;
  files: Record<string, string>;
}

/**
 * A standalone binary carries its runtime files as one packed asset. Unpack them once
 * per build into `<data dir>/runtime/<hash>` and point the server at them.
 */
export async function useSeaRuntime(dataDir: string, env = process.env): Promise<void> {
  let sea: typeof import("node:sea");
  try {
    sea = await import("node:sea");
  } catch {
    return;
  }
  if (!sea.isSea()) return;
  const pack = JSON.parse(sea.getAsset(RUNTIME_ASSET, "utf8")) as RuntimePack;
  const root = join(dataDir, "runtime", pack.hash);
  if (!existsSync(join(root, ".complete"))) {
    const tmp = `${root}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    for (const [rel, b64] of Object.entries(pack.files)) {
      const file = join(tmp, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(b64, "base64"));
    }
    writeFileSync(join(tmp, ".complete"), pack.hash);
    rmSync(root, { recursive: true, force: true });
    renameSync(tmp, root);
  }
  env.SLATE_PLUGINS_DIR ??= join(root, "plugins");
  env.SLATE_DISPLAY_DIR ??= join(root, "display");
  env.SLATE_FRAMEWORK_DIR ??= join(root, "framework");
}
