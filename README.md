# Slate

A self-hosted, TRMNL-style wall display. A small Node server renders widgets as live
HTML; any modern browser in kiosk mode is the display. Built first for a Surface Pro X
on the wall, but the server and display run on Windows (x64/ARM64), macOS, and Linux.

> Working name **Slate**. Package and image names use `slate` until the project is renamed.

**Status: Phase 1b (first run).** It includes the plugin SDK, core layout, scheduling,
and caching, Liquid rendering, the server, the kiosk display client, clock and weather
widgets, a first-run setup wizard with an admin password, starter screens, install
one-liners, standalone binaries, and the `slate dev` plugin preview. The drag-and-drop
editor and theme editor come in Phase 2.

## Glossary

| Term          | Means                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| **Plugin**    | An installable package (a folder under `plugins/`). Contains connectors, widgets, and/or extensions. |
| **Connector** | A data source: TypeScript that fetches and normalizes data. No markup.                               |
| **Widget**    | A view placed on the grid: TRMNL-compatible Liquid templates plus optional `client.js`.              |

## Install

One command, then a browser wizard. No accounts or API keys.

**Windows 11 (x64 or ARM64, including the Surface Pro X)**, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/njm-cursor-x/surfaceprox-trmnl/main/install.ps1 | iex
```

**macOS or Linux (x64 or arm64):**

```bash
curl -fsSL https://raw.githubusercontent.com/njm-cursor-x/surfaceprox-trmnl/main/install.sh | sh
```

**Docker (linux/amd64 + linux/arm64):** add `-s -- --docker` to the line above, or:

```bash
docker run -d --name slate --restart unless-stopped -p 8787:8787 -v slate-data:/data \
  ghcr.io/njm-cursor-x/surfaceprox-trmnl:latest
docker exec slate node apps/server/dist/slate.mjs setup-url   # prints the setup link and code
```

The installers download a standalone `slate` binary (Node SEA; no Node needed), check
its SHA-256 against the release's `SHA256SUMS`, start it at boot, and print the setup
link, a setup code, and a QR code for your phone. Then the wizard walks you through:

1. **Admin password.** Protects the config page and API. On the server itself no code is
   needed; from another device on your network, enter the setup code the installer
   printed (or run `slate setup-url`). This stops someone else on the LAN claiming it first.
2. **Location**, by city search or coordinates. "Use this device's location" only shows in
   a secure context (HTTPS or localhost), because browsers block it on plain HTTP.
3. **Units and night mode.** Night mode starts off.
4. **A starter screen** (Clock + Weather, Morning, or Big clock). All keyless.
5. **Your display:** its URL, a QR code, and copy-paste kiosk commands for Windows (Edge),
   macOS (Chrome), and Linux / Raspberry Pi (Chromium).

Where things go:

| Install     | Program                            | Data                                  | Starts with               |
| ----------- | ---------------------------------- | ------------------------------------- | ------------------------- |
| Windows     | `C:\Program Files\Slate\slate.exe` | `C:\ProgramData\slate`                | Startup task (SYSTEM)     |
| Linux, root | `/usr/local/bin/slate`             | `/var/lib/slate`                      | systemd `slate.service`   |
| Linux, user | `~/.local/bin/slate`               | `~/.local/share/slate`                | systemd user service      |
| macOS       | `~/.local/bin/slate`               | `~/Library/Application Support/slate` | launchd agent             |
| Docker      | image                              | `/data` volume                        | `restart: unless-stopped` |

On Windows both folders are writable by SYSTEM and Administrators only, and the firewall
rule allows TCP 8787 from the local subnet on the **Private** profile only. Set your
Wi-Fi to Private for phones to reach it. Uninstall with `$env:SLATE_UNINSTALL=1` before
the Windows one-liner, or `sh -s -- --uninstall` on macOS/Linux; both keep your data.

Pick a release with `SLATE_VERSION=v0.2.0` and a port with `SLATE_PORT`. Binaries for
linux-x64/arm64, macos-x64/arm64, and win-x64/arm64 are built and smoke-tested in CI,
and attached to releases on `v*` tags. There's no MSIX and no code signing (macOS builds
are ad-hoc signed).

## The `slate` command

```text
slate [serve] [--port 8787] [--host 0.0.0.0] [--data-dir <dir>]
slate setup-url [--qr]     setup link and code for this install
slate dev [plugin-dir]     live plugin preview (see docs/plugins.md)
slate qr <text>            QR code in the terminal
```

## From source

Requires Node 22.13+ (24 recommended) and pnpm (`corepack enable`).

```bash
pnpm install
pnpm build        # bundles the server, compiles plugin connectors, builds the display client
pnpm start        # http://localhost:8787, then follow the setup link it prints
pnpm build:binary # optional: dist/bin/slate-<os>-<arch> for this machine
```

For development: `pnpm dev` (watches the server; data goes to `./.slate-data`), and
`pnpm slate dev plugins/weather` to preview a plugin.

The server only answers requests addressed to an IP address, `localhost`, a single-label
name, or a LAN suffix (`.local`, `.lan`, `.home.arpa`, `.internal`). This blocks DNS
rebinding from websites. If you put Slate behind your own domain, list it in
`SLATE_ALLOWED_HOSTS` (comma-separated, `*.example.com` allowed).

`deploy/windows/install-server.ps1` installs a built checkout on Windows with Node
instead of the binary (it runs a private copy of `node.exe` from `C:\Program Files\Slate`).
`deploy/windows/setup-kiosk.ps1 -Url <display url>` sets up the Edge kiosk on its own.

**Backups:** there's no backup feature yet. Copy the data folder to back it up.
`auth.json` in it holds the admin password hash; delete it to reset the password (this
signs everyone out and the server prints a new setup code).

## Night mode

Each display has a night schedule (`from`/`to`, wrapping midnight). At night it can dim
the screen with an overlay, switch to a dark theme, or both. You can change the schedule
on the config page or in `config.yml`. The screen always stays on, so Windows Modern
Standby can't drop Wi-Fi and take down the on-device server.

## Tests

```bash
pnpm test                 # Vitest: sdk, core, liquid-trmnl, connectors, server API
pnpm test:e2e             # Playwright: display in Chromium, Firefox, and WebKit; wizard in Chromium
pnpm test:acceptance      # the wizard against an installed server at ACCEPTANCE_URL (default :8787)
pnpm lint && pnpm typecheck && pnpm format:check
```

First-time Playwright setup: `pnpm exec playwright install --with-deps`. If your network
blocks Playwright's browser download, point Chromium at an installed browser:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome pnpm test:e2e --project=chromium`.

CI runs unit tests on Linux, macOS, and Windows (x64 and ARM64). It also runs the display
tests in all three browser engines, builds the multi-arch image, builds and smoke-tests
the six standalone binaries, and runs the acceptance test: install with `install.sh`
(Linux), `install.ps1` (Windows x64 and ARM64), or Docker (with the setup code), then
complete the wizard in Chromium and check the display shows the clock and live weather.

## Repo layout

```
apps/server     Hono API, auth, setup wizard, connector runtime, Liquid renderer, SSE, LAN config UI, slate CLI
apps/display    Kiosk client: playlist rotation, SSE, sandboxed widget iframes, night mode
packages/sdk    @slate/sdk: defineConnector, defineWidget, defineExtension, test utils
packages/core   Grid model, slot-to-template mapping, playlists, night schedule, cache, quotas, plugin loader
packages/liquid-trmnl   LiquidJS with TRMNL filters and {% template %}
packages/framework      Trimmed, pinned TRMNL Framework CSS (3.4.6) and Slate's adapter
plugins/        First-party plugins (clock, weather)
deploy/         Dockerfile, Windows install-from-source + kiosk scripts
install.sh, install.ps1   One-line installers
scripts/        stage.mjs (runtime copy), build-sea.mjs (standalone binary)
e2e/            Playwright display, wizard, and acceptance tests
```

See [docs/plugins.md](docs/plugins.md) to write a plugin.

## License

MIT
