# AGENTS.md

Guide for coding agents picking up this repo. Read this first, then [README.md](README.md)
(install, CLI, tests) and [docs/plugins.md](docs/plugins.md) (plugin authoring).

## Project summary

**Slate** (working name; repo `surfaceprox-trmnl`, MIT) is a self-hosted, TRMNL-style wall
display. A small TypeScript/Node server renders widgets as live HTML, and any modern browser in
kiosk mode is the display. The first target is a Surface Pro X (Windows 11 Home on ARM64) that
hosts both the server and an Edge kiosk, but the server and display also run on Windows x64,
macOS, Linux, and multi-arch Docker. Users configure screens from a phone on the LAN. Phase 1a
(plugin architecture, server, kiosk, clock + weather), security hardening, and Phase 1b (setup
wizard, admin auth, installers, standalone binaries, `slate dev`) are merged. Phase 2 widgets are
next.

## Next steps (priority order)

Owner: **Nick** = the repo owner (a human, GitHub `@njm-cursor-x`); **Agent** = a Cursor agent.

1. **Cut the first `v*` GitHub release** (Agent). The install one-liners download from
   `releases/latest/download`, so they fail until a release exists. Tag `main` (suggested
   `v0.2.0`, which the README already uses) and push the tag. That runs the CI `release` job
   (six binaries + `SHA256SUMS`) and publishes a semver GHCR image. Then verify both one-liners
   end to end on a clean machine or CI runner.
2. **Surface Pro X kiosk install and hardware test** through a self-hosted Cursor worker.
   - **Nick** sets up the worker on the Surface (Windows 11 Home ARM64), in PowerShell:
     1. Install [Git for Windows](https://git-scm.com/download/win) (with Git Bash). The worker
        won't start without it.
     2. `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (a fresh Windows install blocks
        local scripts, which makes `agent login` fail).
     3. `irm 'https://cursor.com/install?win32=true' | iex` installs the native ARM64 Cursor
        CLI, then check `agent --version`.
     4. `agent login` with the Cursor account that owns this work (`agent logout` first if
        another account is signed in).
     5. `agent worker start --name "Surface Pro X" --computer-use` and leave it running.
     6. Confirm it shows as connected under
        [My Machines](https://cursor.com/docs/cloud-agent/self-hosted/my-machines). On a team
        plan an admin may need to enable **Allow Self-Hosted Machines**. See the
        [self-hosted docs](https://cursor.com/docs/cloud-agent/self-hosted).
   - **Agent**, on that worker: run the Windows one-liner, complete the wizard on the Surface and
     from a phone-sized browser on the LAN, run `deploy/windows/setup-kiosk.ps1`, confirm the Edge
     kiosk survives a reboot, the display stays on through the night schedule (no Modern
     Standby), and record CPU, memory, and heat over several hours.
3. **Phase 2 widgets and UX** (Agent; one PR each, with tests and screenshots):
   - **Robinhood**: watchlist + quotes, plus live holdings via the **unofficial** private API,
     strictly opt-in with a ToS warning. Don't build SnapTrade. Revisit Liquid auto-escaping
     before rendering positions.
   - **YouTube**: real playback (not just an info card) of public playlists and individual video
     URLs/IDs.
   - **Google Calendar**: first-party, **device-code OAuth** started from the phone. Ship a generic
     ICS plugin as the community example.
   - **Flights**: one widget with **overhead** and **airport board** modes from the user-set
     location. Keyless ADS-B sources first (adsb.lol, then airplanes.live / adsb.fi); OpenSky only
     as a credit-limited fallback.
   - **Grid editor**: drag-and-drop, usable on iOS Safari and Android Chrome. Spike gridstack.js
     vs react-grid-layout; size presets from manifests; per-screen layouts; undo.
   - **Clock faces and themes**: more faces, more first-class themes, a custom theme editor, and
     night-mode schedule UI polish.
   - Also Phase 2: phone config PWA polish, encrypted secrets store, quota-aware scheduler,
     health page.
4. **Enable Cursor Bugbot and security review on this repo** (Nick, in the Cursor dashboard).
   Until then, PRs get no review comments to act on.

## Repo layout

pnpm workspace (`apps/*`, `packages/*`, `plugins/*`), TypeScript, ESM, Node ≥ 22.13 (24
recommended), `pnpm@10.33.4` via corepack.

| Path                           | What                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `apps/server`                  | Hono API, admin auth, setup wizard, connector runtime, Liquid renderer, SSE, config UI, CLI |
| `apps/display`                 | Vite kiosk client: playlist rotation, SSE, sandboxed widget iframes, night mode             |
| `packages/sdk`                 | `@slate/sdk`: `defineConnector`, `defineWidget`, `defineExtension`, test utils              |
| `packages/core`                | Grid model, slot-to-template mapping, playlists, night schedule, cache, quotas, YAML config |
| `packages/liquid-trmnl`        | LiquidJS with TRMNL filters and `{% template %}`                                            |
| `packages/framework`           | Trimmed, pinned TRMNL Framework CSS (3.4.6) + Slate adapter (`vendor/` is third-party)      |
| `plugins/clock`, `/weather`    | First-party plugins (clock faces as extensions; Open-Meteo connector)                       |
| `deploy/docker`, `compose.yml` | Multi-arch Dockerfile (runs as `node`)                                                      |
| `deploy/windows`               | `install-server.ps1` (Node from a checkout), `setup-kiosk.ps1` (Edge kiosk)                 |
| `install.ps1`, `install.sh`    | One-line installers: download release binary, verify `SHA256SUMS`, start at boot            |
| `scripts`                      | `stage.mjs` (runtime copy), `build-sea.mjs` (Node SEA standalone binary)                    |
| `e2e`                          | Playwright display, wizard, and acceptance tests                                            |

## Commands

```bash
corepack enable && pnpm install
pnpm build                        # server bundle, plugin connectors, display client
pnpm start                        # http://localhost:8787; follow the setup link it prints
pnpm dev                          # watch mode, data in ./.slate-data
pnpm slate dev plugins/weather    # live plugin preview
pnpm build:binary                 # dist/bin/slate-<os>-<arch> for this machine

pnpm lint && pnpm format:check && pnpm typecheck
pnpm test                         # Vitest
pnpm exec playwright install --with-deps
pnpm test:e2e                     # Playwright: display in 3 engines, wizard in Chromium
pnpm test:acceptance              # wizard against an installed server (ACCEPTANCE_URL, default :8787)
```

Run `pnpm format` before committing: CI runs `prettier --check .`, which includes Markdown. If
Playwright's browser download is blocked, use
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome pnpm test:e2e --project=chromium`.

### CI and gotchas

- `ci.yml` (PRs, `main`, `v*` tags): lint/format/typecheck; Vitest on Linux x64/arm64, macOS,
  Windows x64 and `windows-11-arm`; Playwright in three engines; installer parse checks;
  multi-arch Docker build; six standalone binaries, each smoke-tested; acceptance installs
  (`install.sh` on Linux, Docker with setup code, `install.ps1` on win-x64 and win-arm64) that
  complete the wizard and check live weather. The `release` job runs only on `v*` tags.
  `docker-publish.yml` pushes `ghcr.io/njm-cursor-x/surfaceprox-trmnl` on `main` and semver tags.
- **Use `127.0.0.1`, not `localhost`, in health checks.** The server listens on IPv4 only and
  Windows PowerShell tries `::1` first, then times out.
- Installers honor `SLATE_VERSION`, `SLATE_PORT`, `SLATE_BINARY` (local binary instead of a
  release download; CI uses this), `SLATE_NO_BROWSER=1`, and `SLATE_UNINSTALL=1` (Windows) /
  `sh -s -- --uninstall`.
- Agent sandboxes may block Open-Meteo and other external APIs. Unit tests use fixtures; the CI
  acceptance jobs hit live weather.
- Phones reach port 8787 only if Windows Wi-Fi is on the **Private** profile. Wizard geolocation
  needs a secure context, so on LAN http city search is the path.

## Conventions

- **Terminology is fixed.** A **plugin** is an installable package; a **connector** is a data
  source (TypeScript, no markup); a **widget** is a view on the grid (TRMNL-compatible Liquid +
  optional `client.js`). Don't use them interchangeably.
- Widgets render in iframes with `sandbox="allow-scripts"` (no same-origin) and
  `connect-src 'none'`. Connectors get a scoped `fetch` that checks the host allowlist on every
  redirect hop. Keep both properties.
- The server only accepts IP literals, `localhost`, single-label names, LAN suffixes, and
  `SLATE_ALLOWED_HOSTS` (DNS-rebinding guard). Cross-origin writes are rejected. Admin auth guards
  the config API; displays use a read-only per-display token.
- Config is `config.yml` in the data dir; `auth.json` holds the admin password hash.
- Default widgets must work with no API keys or accounts. Never hardcode a user's location.
- Write plugins as described in [docs/plugins.md](docs/plugins.md); clock faces are
  `clock.face` extensions.

### Product decisions (condensed)

| #   | Decision                                                                                     |
| --- | -------------------------------------------------------------------------------------------- |
| D1  | The Surface hosts everything: win-arm64 binary (or Node), not Docker, on the Surface.        |
| D2  | Windows 11 Home: Edge `--kiosk`, no Assigned Access.                                         |
| D3  | First-party Google Calendar via OAuth; other calendars via plugins. Proton later, maybe.     |
| D4  | Robinhood: watchlist and live holdings.                                                      |
| D5  | YouTube actually plays video.                                                                |
| D6  | MIT license.                                                                                 |
| D7  | Free-form grid plus example templates.                                                       |
| D8  | Robinhood holdings via the unofficial API for now (opt-in, ToS warning). No SnapTrade first. |
| D9  | YouTube sources: public playlists and individual video URLs/IDs.                             |
| D10 | Location is user-set in the wizard/config (weather, sun times, flights).                     |
| D11 | Many first-class themes plus a custom theme editor; TRMNL Framework is the default theme.    |
| D12 | Landscape (3:2) first; portrait later.                                                       |
| D13 | Name stays Slate (packages/images use `slate`); repo is `njm-cursor-x/surfaceprox-trmnl`.    |
| D14 | LAN-only: config UI at `http://<host-ip>:8787` from phone, host, or laptop. No Tailscale.    |
| D15 | One flights widget, overhead + airport board modes, in Phase 2.                              |
| D16 | Scheduled night mode (dim and/or dark). Display stays on to avoid Modern Standby.            |
| D17 | Backup/restore deferred past v1; copying the data folder is the interim backup.              |
| D18 | No MSIX, no code signing. Unsigned binary / Node / multi-arch Docker. No Kubernetes.         |

Known accepted risks: Liquid output isn't auto-escaped (TRMNL compatibility); connectors run
in-process (worker isolation is Phase 3); no per-token SSE connection cap; CI actions are pinned
to tags, not SHAs.

## Working rules for agents

- Ship each piece of work as its own PR off `main`, with tests for new behavior (Vitest for logic
  and API, Playwright for display/wizard flows) and screenshots for UI changes.
- Run lint, format check, typecheck, and tests locally before pushing.
- After CI is green, fix any Cursor Bugbot or security review comments, wait for CI to go green
  again, then squash-merge with `gh pr merge --squash`. Nick has pre-authorized this; no need to
  ask again.
- Don't commit secrets, tokens, or personal details. This repo is public.
- Keep the README in sync when install steps, commands, or user-facing behavior change.
