import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfig, type SlateConfig, type SlateConfigInput } from "@slate/core";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Keyless starter: clock + weather. Weather shows "Set your location" until the user sets one. */
export function starterConfig(token = randomBytes(18).toString("base64url")): SlateConfig {
  const input: SlateConfigInput = {
    location: null,
    instances: {
      clock: { widget: "clock", settings: { face: "digital" } },
      weather: { widget: "weather", settings: {} },
    },
    screens: {
      home: {
        name: "Clock + Weather",
        grid: {
          cols: 12,
          rows: 8,
          items: [
            { instance: "clock", x: 0, y: 0, w: 7, h: 8 },
            { instance: "weather", x: 7, y: 0, w: 5, h: 8 },
          ],
        },
      },
    },
    playlists: { default: { items: [{ screen: "home", dwell: "5m" }] } },
    displays: { main: { name: "This display", token, playlist: "default" } },
  };
  return parseConfig(input);
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
