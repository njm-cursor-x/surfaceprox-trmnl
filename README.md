# Slate

A self-hosted, TRMNL-style wall display. A small Node server renders widgets as live
HTML; any modern browser in kiosk mode is the display. Built first for a Surface Pro X
on the wall, but the server and display run on Windows (x64/ARM64), macOS, and Linux.

> Working name **Slate**. Package and image names use `slate` until the project is renamed.

**Status: Phase 1a (plugin architecture).** It includes the plugin SDK, core layout,
scheduling, and caching, Liquid rendering, the server, the kiosk display client, a
clock widget, a weather widget, and a basic LAN config page. The first-run wizard,
example layouts, and install one-liners come in Phase 1b. The drag-and-drop editor and
theme editor come in Phase 2.

## Glossary

| Term          | Means                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| **Plugin**    | An installable package (a folder under `plugins/`). Contains connectors, widgets, and/or extensions. |
| **Connector** | A data source: TypeScript that fetches and normalizes data. No markup.                               |
| **Widget**    | A view placed on the grid: TRMNL-compatible Liquid templates plus optional `client.js`.              |

## Quick start (from source)

Requires Node 22.13+ (24 recommended) and pnpm (`corepack enable`).

```bash
pnpm install
pnpm build        # bundles the server, compiles plugin connectors, builds the display client
pnpm start        # http://localhost:8787
```

The console prints the config UI URL (also reachable from your phone on the LAN) and the
display URL (`/d/<token>`). Open the display URL in a full-screen browser. Set a
location on the config page to turn on weather; the clock works immediately.

For development: `pnpm dev` (watches the server; data goes to `./.slate-data`).

## Install

There are two supported paths:

### Everyone else: Docker (linux/amd64 + linux/arm64)

```bash
docker run -d --name slate --restart unless-stopped -p 8787:8787 -v slate-data:/data \
  ghcr.io/njm-cursor-x/surfaceprox-trmnl:latest
```

Or `docker compose up -d` with the repo's [`compose.yml`](compose.yml). The image is
built and published by [`docker-publish.yml`](.github/workflows/docker-publish.yml) on
pushes to `main` and on version tags. Kubernetes is not a target.

### Surface Pro X / Windows 11 (Node, no Docker)

From an elevated PowerShell in a built checkout:

```powershell
winget install OpenJS.NodeJS.LTS          # native ARM64 build
corepack enable; pnpm install; pnpm build
powershell -ExecutionPolicy Bypass -File deploy\windows\install-server.ps1
powershell -ExecutionPolicy Bypass -File deploy\windows\setup-kiosk.ps1 -Url http://localhost:8787/d/<token>
```

`install-server.ps1` copies the runtime to `C:\Program Files\Slate` and stores data in
`C:\ProgramData\slate`. It registers a startup task that restarts on failure, and it
opens TCP 8787 on the **Private** network profile only. `setup-kiosk.ps1` launches Edge
with `--kiosk` at logon, relaunches it if it exits, applies Edge policies, and keeps
the display awake. Phase 1b adds a standalone win-arm64 binary and an `irm | iex`
one-liner. There's no MSIX and no code signing.

**Backups:** there's no backup feature yet. Copy the data folder (`/data` or
`C:\ProgramData\slate`) to back it up.

## Night mode

Each display has a night schedule (`from`/`to`, wrapping midnight). At night it can dim
the screen with an overlay, switch to a dark theme, or both. You can change the schedule
on the config page or in `config.yml`. The screen always stays on, so Windows Modern
Standby can't drop Wi-Fi and take down the on-device server.

## Tests

```bash
pnpm test                 # Vitest: sdk, core, liquid-trmnl, connectors, server API
pnpm test:e2e             # Playwright: display in Chromium, Firefox, and WebKit
pnpm lint && pnpm typecheck && pnpm format:check
```

First-time Playwright setup: `pnpm exec playwright install --with-deps`. If your network
blocks Playwright's browser download, point Chromium at an installed browser:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome pnpm test:e2e --project=chromium`.

CI runs unit tests on Linux, macOS, and Windows (x64 and ARM64). It also runs the display
tests in all three browser engines, builds the multi-arch image, and checks that the
PowerShell scripts parse.

## Repo layout

```
apps/server     Hono API, connector runtime, Liquid renderer, SSE, LAN config UI
apps/display    Kiosk client: playlist rotation, SSE, sandboxed widget iframes, night mode
packages/sdk    @slate/sdk: defineConnector, defineWidget, defineExtension, test utils
packages/core   Grid model, slot-to-template mapping, playlists, night schedule, cache, quotas, plugin loader
packages/liquid-trmnl   LiquidJS with TRMNL filters and {% template %}
plugins/        First-party plugins (clock, weather)
deploy/         Dockerfile, Windows install + kiosk scripts
e2e/            Playwright display tests
```

See [docs/plugins.md](docs/plugins.md) to write a plugin.

## License

MIT
