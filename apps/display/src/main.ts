import { currentItem, nightState, type NightMode, type Playlist } from "@slate/core/browser";

interface Cell {
  instance: string;
  widget: string;
  layout: string;
  x: number;
  y: number;
  w: number;
  h: number;
  html: string;
}

interface Screen {
  name: string;
  cols: number;
  rows: number;
  gap: number;
  cells: Cell[];
}

interface DisplayState {
  version: number;
  display: {
    id: string;
    name?: string;
    theme: string;
    timezone?: string;
    pixelShift: boolean;
    night: NightMode;
  };
  playlist: Playlist;
  screens: Record<string, Screen>;
}

const params = new URLSearchParams(location.search);
const token = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() ?? "");
const api = `/api/display/${encodeURIComponent(token)}`;
const WATCHDOG_MS = Number(params.get("watchdog") ?? 90_000);
const PIXEL_SHIFT_MS = Number(params.get("shift") ?? 180_000);

const screenEl = document.getElementById("screen")!;
const messageEl = document.getElementById("message")!;
const dimEl = document.getElementById("dim")!;
const rootEl = document.getElementById("root")!;

let state: DisplayState | null = null;
let shownScreen: string | null = null;
let theme = "paper";
let lastBeat = Date.now();
const frames = new Map<string, HTMLIFrameElement>();

function showMessage(text: string | null) {
  messageEl.hidden = text === null;
  messageEl.textContent = text ?? "";
}

function postTheme(frame: HTMLIFrameElement) {
  // Sandboxed frames have an opaque origin, so "*" is the only usable target.
  frame.contentWindow?.postMessage({ type: "slate:theme", theme }, "*");
}

function makeFrame(cell: Cell): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  // Never add allow-same-origin: a srcdoc frame would then share the display's origin
  // and widget scripts could reach the parent page and its API token.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = cell.instance;
  frame.dataset.instance = cell.instance;
  frame.addEventListener("load", () => postTheme(frame));
  frame.srcdoc = cell.html;
  return frame;
}

function renderScreen(id: string, screen: Screen, rebuild: boolean) {
  document.body.dataset.screen = id;
  screenEl.style.gridTemplateColumns = `repeat(${screen.cols}, minmax(0, 1fr))`;
  screenEl.style.gridTemplateRows = `repeat(${screen.rows}, minmax(0, 1fr))`;
  screenEl.style.setProperty("--gap", `${screen.gap}px`);
  if (rebuild) {
    screenEl.replaceChildren();
    frames.clear();
  }
  const keep = new Set<string>();
  for (const cell of screen.cells) {
    keep.add(cell.instance);
    let frame = frames.get(cell.instance);
    if (!frame) {
      frame = makeFrame(cell);
      const wrap = document.createElement("div");
      wrap.className = "cell";
      wrap.append(frame);
      screenEl.append(wrap);
      frames.set(cell.instance, frame);
    } else if (frame.srcdoc !== cell.html) {
      frame.srcdoc = cell.html;
    }
    const wrap = frame.parentElement!;
    wrap.dataset.instance = cell.instance;
    wrap.dataset.layout = cell.layout;
    wrap.style.gridColumn = `${cell.x + 1} / span ${cell.w}`;
    wrap.style.gridRow = `${cell.y + 1} / span ${cell.h}`;
  }
  for (const [instance, frame] of frames) {
    if (!keep.has(instance)) {
      frame.parentElement?.remove();
      frames.delete(instance);
    }
  }
}

function update(force = false) {
  if (!state) return;
  const now = new Date();
  const pos = currentItem(state.playlist, now, new Date(0), state.display.timezone);
  const screen = pos && state.screens[pos.item.screen];
  if (!pos || !screen) {
    shownScreen = null;
    screenEl.replaceChildren();
    frames.clear();
    showMessage("Nothing is scheduled right now.");
  } else {
    showMessage(null);
    const changed = shownScreen !== pos.item.screen;
    if (changed || force) renderScreen(pos.item.screen, screen, changed);
    shownScreen = pos.item.screen;
  }
  applyNight(now);
}

function applyNight(now: Date) {
  if (!state) return;
  const night = nightState(state.display.night, state.display.theme, now, state.display.timezone);
  document.body.dataset.night = String(night.active);
  dimEl.style.opacity = String(night.dim);
  if (night.theme !== theme) {
    theme = night.theme;
    document.documentElement.dataset.theme = theme;
    frames.forEach(postTheme);
  }
}

async function loadState() {
  const res = await fetch(`${api}/state`, { cache: "no-store" });
  if (res.status === 404) {
    showMessage("This display link is no longer valid. Open the config page for a new one.");
    return;
  }
  if (!res.ok) throw new Error(`state ${res.status}`);
  state = (await res.json()) as DisplayState;
  document.body.dataset.version = String(state.version);
  update(true);
}

function connect() {
  const events = new EventSource(`${api}/events`);
  events.addEventListener("state", (e) => {
    lastBeat = Date.now();
    const { version } = JSON.parse((e as MessageEvent).data) as { version: number };
    if (!state || version !== state.version) loadState().catch(() => undefined);
  });
  events.addEventListener("ping", () => {
    lastBeat = Date.now();
  });
  events.addEventListener("open", () => {
    lastBeat = Date.now();
    document.body.dataset.connected = "true";
  });
  events.addEventListener("error", () => {
    document.body.dataset.connected = "false";
  });
}

/** Reloads on a stale heartbeat, but only once the server answers, so the kiosk never lands on a browser error page. */
async function watchdog() {
  if (Date.now() - lastBeat < WATCHDOG_MS) return;
  try {
    const res = await fetch("/healthz", { cache: "no-store" });
    if (res.ok) location.reload();
  } catch {
    // Server still unreachable; EventSource keeps retrying.
  }
}

const SHIFTS = [
  [0, 0],
  [2, 1],
  [-1, 3],
  [-3, -1],
  [1, -2],
] as const;
let shiftIndex = 0;
function pixelShift() {
  if (!state?.display.pixelShift) {
    rootEl.style.transform = "";
    return;
  }
  shiftIndex = (shiftIndex + 1) % SHIFTS.length;
  const [x, y] = SHIFTS[shiftIndex]!;
  rootEl.style.transform = `translate(${x}px, ${y}px)`;
}

type WakeLockNav = Navigator & { wakeLock?: { request(type: "screen"): Promise<unknown> } };
async function keepAwake() {
  try {
    await (navigator as WakeLockNav).wakeLock?.request("screen");
  } catch {
    // Unsupported or denied; the OS power settings from the kiosk scripts cover this.
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void keepAwake();
    loadState().catch(() => undefined);
  }
});

showMessage("Connecting…");
loadState().catch(() => showMessage("Waiting for the Slate server…"));
connect();
void keepAwake();
setInterval(() => update(), 1_000);
setInterval(() => void watchdog(), 15_000);
setInterval(pixelShift, PIXEL_SHIFT_MS);
