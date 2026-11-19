#!/bin/sh
# One-line Slate install for Linux and macOS:
#   curl -fsSL https://raw.githubusercontent.com/njm-cursor-x/surfaceprox-trmnl/main/install.sh | sh
#   ... | sh -s -- --docker      run the Docker image with compose instead of the binary
#
# The binary install puts `slate` in /usr/local/bin (as root) or ~/.local/bin, and starts
# it at boot: a systemd system service as root, a systemd user service or launchd agent
# otherwise. Then it prints the setup link, setup code, and a QR code.
#
# Environment: SLATE_VERSION (release tag, default latest), SLATE_PORT (8787),
# SLATE_BINARY (use a local binary instead of downloading), SLATE_DIR (compose folder).
set -eu

REPO="njm-cursor-x/surfaceprox-trmnl"
PORT="${SLATE_PORT:-8787}"
MODE=binary
for arg in "$@"; do
  case "$arg" in
    --docker) MODE=docker ;;
    --uninstall) MODE=uninstall ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
die() { printf 'slate install: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

if [ -n "${SLATE_VERSION:-}" ]; then
  BASE="https://github.com/$REPO/releases/download/$SLATE_VERSION"
else
  BASE="https://github.com/$REPO/releases/latest/download"
fi

download() {
  if have curl; then curl -fsSL "$1" -o "$2"
  elif have wget; then wget -qO "$2" "$1"
  else die "curl or wget is required"; fi
}

wait_healthy() {
  i=0
  while [ $i -lt 60 ]; do
    if have curl; then curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && return 0
    else wget -qO /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null && return 0; fi
    i=$((i + 1)); sleep 1
  done
  return 1
}

if [ "$MODE" = docker ]; then
  have docker || die "Docker isn't installed. Get it from https://docs.docker.com/get-docker/ or drop --docker."
  DIR="${SLATE_DIR:-$HOME/slate}"
  mkdir -p "$DIR"
  download "https://raw.githubusercontent.com/$REPO/main/compose.yml" "$DIR/compose.yml"
  say "Starting Slate with Docker in $DIR"
  (cd "$DIR" && docker compose pull --quiet slate && docker compose up -d --no-build)
  wait_healthy || die "Slate didn't answer on port $PORT. See: docker logs slate"
  say ""
  say "Slate is running."
  docker exec slate node apps/server/dist/slate.mjs setup-url --qr --port "$PORT"
  exit 0
fi

OS=$(uname -s)
case "$OS" in
  Linux) OS=linux ;;
  Darwin) OS=macos ;;
  *) die "Unsupported OS $OS. On Windows, use install.ps1." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) die "Unsupported CPU $(uname -m). Use --docker or run from source." ;;
esac
ASSET="slate-$OS-$ARCH"

if [ "$(id -u)" = 0 ]; then
  BIN_DIR=/usr/local/bin
  DATA_DIR=/var/lib/slate
  SCOPE=system
else
  BIN_DIR="$HOME/.local/bin"
  DATA_DIR=""
  SCOPE=user
fi
BIN="$BIN_DIR/slate"

if [ "$MODE" = uninstall ]; then
  if [ "$OS" = macos ]; then
    launchctl unload "$HOME/Library/LaunchAgents/dev.slate.server.plist" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/dev.slate.server.plist"
  elif [ "$SCOPE" = system ]; then
    systemctl disable --now slate 2>/dev/null || true
    rm -f /etc/systemd/system/slate.service
  else
    systemctl --user disable --now slate 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/slate.service"
  fi
  rm -f "$BIN"
  say "Slate removed. Your settings are kept in its data folder."
  exit 0
fi

mkdir -p "$BIN_DIR" ${DATA_DIR:+"$DATA_DIR"}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if [ -n "${SLATE_BINARY:-}" ]; then
  cp "$SLATE_BINARY" "$TMP/slate"
else
  say "Downloading $ASSET"
  download "$BASE/$ASSET" "$TMP/slate"
  download "$BASE/SHA256SUMS" "$TMP/SHA256SUMS"
  EXPECTED=$(awk -v f="$ASSET" '$2 == f || $2 == "*" f { print $1 }' "$TMP/SHA256SUMS")
  if have sha256sum; then ACTUAL=$(sha256sum "$TMP/slate" | awk '{print $1}')
  else ACTUAL=$(shasum -a 256 "$TMP/slate" | awk '{print $1}'); fi
  [ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || die "Checksum mismatch for $ASSET; not installing."
fi
chmod 755 "$TMP/slate"
mv -f "$TMP/slate" "$BIN"
[ "$OS" = macos ] && xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true

SERVE="$BIN serve --port $PORT${DATA_DIR:+ --data-dir $DATA_DIR}"
if [ "$OS" = macos ]; then
  PLIST="$HOME/Library/LaunchAgents/dev.slate.server.plist"
  mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.slate.server</string>
  <key>ProgramArguments</key><array>
    <string>$BIN</string><string>serve</string><string>--port</string><string>$PORT</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/slate.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/slate.log</string>
</dict></plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST"
  HOW="launchd (log: ~/Library/Logs/slate.log)."
elif [ "$SCOPE" = system ] && have systemctl && [ -d /run/systemd/system ]; then
  id slate >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin slate
  mkdir -p "$DATA_DIR"
  chown slate:slate "$DATA_DIR"
  chmod 700 "$DATA_DIR"
  cat >/etc/systemd/system/slate.service <<EOF
[Unit]
Description=Slate wall display server
After=network-online.target
Wants=network-online.target

[Service]
User=slate
ExecStart=$SERVE
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable slate >/dev/null 2>&1
  systemctl restart slate
  HOW="systemd (journalctl -u slate)."
elif have systemctl && systemctl --user show-environment >/dev/null 2>&1; then
  UNIT="$HOME/.config/systemd/user/slate.service"
  mkdir -p "$(dirname "$UNIT")"
  cat >"$UNIT" <<EOF
[Unit]
Description=Slate wall display server

[Service]
ExecStart=$SERVE
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable slate >/dev/null 2>&1
  systemctl --user restart slate
  HOW="systemd user service (journalctl --user -u slate). Run 'loginctl enable-linger $USER' to start it before you sign in."
else
  LOG="${DATA_DIR:-$HOME}/slate.log"
  nohup $SERVE >"$LOG" 2>&1 &
  HOW="a background process (log: $LOG). It won't restart after a reboot."
fi

wait_healthy || die "Slate didn't answer on port $PORT. It was started by $HOW"
say ""
say "Slate is running, started by $HOW"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "Add $BIN_DIR to your PATH to use the slate command." ;; esac
if [ "$SCOPE" = system ]; then
  runuser -u slate -- "$BIN" setup-url --qr --port "$PORT" --data-dir "$DATA_DIR" 2>/dev/null ||
    "$BIN" setup-url --qr --port "$PORT" --data-dir "$DATA_DIR"
else
  "$BIN" setup-url --qr --port "$PORT"
fi
