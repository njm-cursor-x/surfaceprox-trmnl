import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { resolvePluginDir, startDev } from "./dev-preview.ts";
import { VERSION } from "./meta.ts";
import { qrTerminal } from "./qr.ts";
import { useSeaRuntime } from "./sea-runtime.ts";
import { resolveStart, setupUrls, startServer } from "./start.ts";

const HELP = `Slate ${VERSION}: a self-hosted, TRMNL-style wall display

Usage:
  slate [serve] [--port 8787] [--host 0.0.0.0] [--data-dir <dir>]
                            Run the server (the default command)
  slate setup-url [--qr]    Print the first-run setup link (and setup code) for this install
  slate dev [plugin-dir] [--port 8788] [--lat <n> --lon <n>] [--tz <zone>]
            [--units celsius|fahrenheit] [--fixture <url>=<file.json> ...]
                            Live preview of a plugin's widgets in all four TRMNL layouts,
                            at Surface (1440x960) and TRMNL OG (800x480) sizes
  slate qr <text>           Print a QR code in the terminal
  slate version             Print the version

Environment: SLATE_PORT, SLATE_HOST, SLATE_DATA_DIR, SLATE_BASE_URL
`;

export async function runCli(argv: string[], dev = false): Promise<number> {
  const [first, ...rest] = argv;
  const command = !first || first.startsWith("-") ? "serve" : first;
  const args = !first || first.startsWith("-") ? argv : rest;

  switch (command) {
    case "serve": {
      const { values } = parseArgs({
        args,
        options: {
          port: { type: "string" },
          host: { type: "string" },
          "data-dir": { type: "string" },
          help: { type: "boolean", short: "h" },
          version: { type: "boolean", short: "v" },
        },
      });
      if (values.help) return print(HELP);
      if (values.version) return print(VERSION);
      const opts = {
        port: values.port ? Number(values.port) : undefined,
        host: values.host,
        dataDir: values["data-dir"],
        dev,
      };
      await useSeaRuntime(resolveStart(opts).dataDir);
      await startServer(opts);
      return -1;
    }
    case "setup-url": {
      const { values } = parseArgs({
        args,
        options: {
          qr: { type: "boolean" },
          port: { type: "string" },
          "data-dir": { type: "string" },
        },
      });
      const { port, dataDir } = resolveStart({
        port: values.port ? Number(values.port) : undefined,
        dataDir: values["data-dir"],
      });
      const codeFile = join(dataDir, "setup-code");
      if (!existsSync(codeFile)) {
        if (!existsSync(join(dataDir, "auth.json"))) {
          console.error(`No Slate data in ${dataDir} yet. Start the server first.`);
          return 1;
        }
        return print(`Setup is already done. Sign in at http://localhost:${port}`);
      }
      const code = readFileSync(codeFile, "utf8").trim();
      const urls = setupUrls(port, code);
      console.log(`On this machine:   ${urls.local}`);
      for (const u of urls.lan) console.log(`From your network: ${u}`);
      console.log(`Setup code:        ${code}`);
      if (values.qr && urls.lan[0]) console.log(qrTerminal(urls.lan[0]));
      return 0;
    }
    case "dev": {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
          port: { type: "string" },
          lat: { type: "string" },
          lon: { type: "string" },
          tz: { type: "string" },
          units: { type: "string" },
          theme: { type: "string" },
          fixture: { type: "string", multiple: true },
        },
      });
      const fixtures: Record<string, string> = {};
      for (const f of values.fixture ?? []) {
        const i = f.lastIndexOf("=");
        if (i < 1) throw new Error(`--fixture expects <url>=<file.json>, got "${f}"`);
        fixtures[f.slice(0, i)] = f.slice(i + 1);
      }
      const lat = values.lat === undefined ? undefined : Number(values.lat);
      const lon = values.lon === undefined ? undefined : Number(values.lon);
      await startDev({
        dir: resolvePluginDir(positionals[0]),
        port: values.port ? Number(values.port) : undefined,
        location:
          lat !== undefined && lon !== undefined
            ? { lat, lon, name: "Preview", timezone: values.tz }
            : undefined,
        units:
          values.units === "celsius" || values.units === "fahrenheit"
            ? { temperature: values.units, time: "12h" }
            : undefined,
        theme: values.theme,
        fixtures,
      });
      return -1;
    }
    case "qr":
      if (!args[0]) return print("Usage: slate qr <text>", 1);
      return print(qrTerminal(args.join(" ")));
    case "version":
    case "--version":
      return print(VERSION);
    case "help":
      return print(HELP);
    default:
      return print(`Unknown command "${command}".\n\n${HELP}`, 1);
  }
}

function print(text: string, code = 0): number {
  (code ? console.error : console.log)(text);
  return code;
}
