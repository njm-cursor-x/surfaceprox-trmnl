import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfig, type SlateConfig } from "@slate/core";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { applyStarter, DEFAULT_STARTER, newDisplay, newToken } from "./starters.ts";

/**
 * Pre-wizard config: the keyless Clock + Weather starter on one display. Weather shows
 * "Set your location" until the user sets one, and night mode stays off so a fresh
 * install during the evening doesn't come up dimmed.
 */
export function starterConfig(token = newToken()): SlateConfig {
  const base = parseConfig({
    location: null,
    displays: { main: { ...newDisplay("default"), token } },
  });
  return applyStarter(base, DEFAULT_STARTER);
}

export class ConfigStore extends EventEmitter<{ change: [SlateConfig] }> {
  readonly file: string;
  private current: SlateConfig;

  constructor(
    readonly dataDir: string,
    initial?: SlateConfig,
  ) {
    super();
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "config.yml");
    if (existsSync(this.file)) {
      this.current = parseConfig(parseYaml(readFileSync(this.file, "utf8")));
    } else {
      this.current = initial ?? starterConfig();
      this.write(this.current);
    }
  }

  get(): SlateConfig {
    return this.current;
  }

  toYaml(): string {
    return stringifyYaml(this.current);
  }

  save(next: SlateConfig): void {
    this.write(next);
    this.current = next;
    this.emit("change", next);
  }

  private write(config: SlateConfig): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, stringifyYaml(config), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
