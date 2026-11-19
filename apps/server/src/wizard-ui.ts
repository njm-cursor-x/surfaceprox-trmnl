import { RAW_BASE } from "./meta.ts";
import { UI_CSS } from "./ui-css.ts";

/**
 * First-run wizard: admin password, location, units and night mode, starter screen,
 * then displays (URL, QR code, kiosk one-liners). Plain DOM, no build step.
 */
export function wizardHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Set up Slate</title>
<style>${UI_CSS}
.steps{display:flex;gap:6px;margin:8px 0 4px;padding:0;list-style:none}
.steps li{flex:1;height:4px;border-radius:2px;background:var(--line);margin:0}
.steps li.done{background:var(--ink)}
.step[hidden]{display:none}
.cards{display:grid;gap:10px}
.card{display:flex;gap:12px;align-items:center;padding:12px;border:2px solid var(--line);border-radius:10px;background:var(--paper);cursor:pointer}
.card:has(input:checked){border-color:var(--ink)}
.card input{width:auto;margin:0}
.mini{flex:none;width:96px;height:64px;display:grid;grid-template-columns:repeat(12,1fr);grid-template-rows:repeat(8,1fr);gap:2px;background:var(--line);border-radius:4px;padding:2px}
.mini span{background:var(--card);border-radius:2px;font-size:9px;line-height:1.1;padding:2px;overflow:hidden;color:var(--muted)}
.card strong{display:block}.card small{color:var(--muted)}
.qr{width:180px;height:180px;background:#fff;border-radius:8px;padding:6px;display:block}
.display{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin:12px 0}
.display .info{flex:1;min-width:220px}
pre{white-space:pre-wrap;word-break:break-all;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:.8rem;margin:4px 0}
details{margin:8px 0}summary{cursor:pointer;min-height:32px}
.note{font-size:.9rem;color:var(--muted)}
.inline{display:flex;gap:8px;align-items:center}.inline input{flex:1}
</style></head>
<body><main>
<h1>Set up Slate</h1>
<ol class="steps" id="steps" aria-hidden="true"><li></li><li></li><li></li><li></li><li></li></ol>

<section class="step" id="step-admin" hidden>
  <h2 id="admin-title">Create the admin password</h2>
  <p class="sub" id="admin-sub">You'll use it to change settings from any browser on your network.</p>
  <form id="admin-form">
    <div id="code-wrap" hidden>
      <label for="setup-code">Setup code</label>
      <input id="setup-code" autocomplete="one-time-code" autocapitalize="characters">
      <p class="note">Shown by the installer and in the server's log (<code>slate setup-url</code>, or <code>docker logs slate</code>). Not needed when you open setup on the server itself.</p>
    </div>
    <label for="admin-pw">Password</label>
    <input id="admin-pw" type="password" autocomplete="new-password" required>
    <div id="confirm-wrap"><label for="admin-pw2">Confirm password</label>
    <input id="admin-pw2" type="password" autocomplete="new-password"></div>
    <div class="actions"><button type="submit" id="admin-go">Continue</button></div>
  </form>
  <div class="status" id="admin-status"></div>
</section>

<section class="step" id="step-location" hidden>
  <h2>Where is this display?</h2>
  <p class="sub">Weather and sunrise use it. Search for your city.</p>
  <label for="loc-q">City</label>
  <input id="loc-q" placeholder="e.g. Portland" autocomplete="off">
  <div class="results" id="loc-results"></div>
  <p class="note" id="loc-picked"></p>
  <div class="actions"><button class="secondary" type="button" id="loc-geo" hidden>Use this device's location</button></div>
  <p class="note" id="loc-geo-note" hidden>Sharing this device's location needs HTTPS or localhost, so it's off here. Search for your city instead.</p>
  <details id="loc-manual"><summary>Enter coordinates instead</summary>
    <div class="row">
      <div><label for="loc-lat">Latitude</label><input id="loc-lat" inputmode="decimal"></div>
      <div><label for="loc-lon">Longitude</label><input id="loc-lon" inputmode="decimal"></div>
    </div>
    <label for="loc-name">Label</label><input id="loc-name">
    <label for="loc-tz">Time zone</label><input id="loc-tz">
  </details>
  <div class="actions"><button type="button" id="loc-go">Continue</button><button class="secondary" type="button" id="loc-skip">Skip for now</button></div>
  <div class="status" id="loc-status"></div>
</section>

<section class="step" id="step-units" hidden>
  <h2>Units and night mode</h2>
  <div class="row">
    <div><label for="u-temp">Temperature</label><select id="u-temp"><option value="fahrenheit">°F</option><option value="celsius">°C</option></select></div>
    <div><label for="u-time">Time</label><select id="u-time"><option value="12h">12-hour</option><option value="24h">24-hour</option></select></div>
  </div>
  <label style="margin-top:18px"><input type="checkbox" id="n-enabled">Dim the screen and switch to a dark theme at night</label>
  <div class="row" id="n-times">
    <div><label for="n-from">From</label><input type="time" id="n-from" value="22:00"></div>
    <div><label for="n-to">Until</label><input type="time" id="n-to" value="07:00"></div>
  </div>
  <p class="note" id="n-note">The screen stays on at night so the device doesn't go to sleep. You can change this later.</p>
  <div class="actions"><button type="button" id="units-go">Continue</button></div>
  <div class="status" id="units-status"></div>
</section>

<section class="step" id="step-starter" hidden>
  <h2>Pick a starter screen</h2>
  <p class="sub">These need no accounts or API keys. You can rearrange them later.</p>
  <div class="cards" id="starters"></div>
  <div class="actions"><button type="button" id="starter-go">Continue</button></div>
  <div class="status" id="starter-status"></div>
</section>

<section class="step" id="step-display" hidden>
  <h2>Add your display</h2>
  <p class="sub">Open the display link in a full-screen browser on the device you'll hang on the wall.</p>
  <label id="same-wrap"><input type="checkbox" id="same-machine">The display runs on this server (for example the Surface itself)</label>
  <div id="display-list"></div>
  <form class="inline" id="add-form">
    <input id="add-name" placeholder="Name another display, e.g. Kitchen tablet" aria-label="New display name">
    <button type="submit" class="secondary">Add display</button>
  </form>
  <div class="status" id="display-status"></div>
  <div class="actions"><button type="button" id="finish">Finish</button></div>
</section>
</main>
<script>
const RAW = ${JSON.stringify(RAW_BASE)};
const $ = (id) => document.getElementById(id);
const ORDER = ["admin", "location", "units", "starter", "display"];
let session, config;
function status(id, msg, err) { const el = $(id); el.textContent = msg || ""; el.className = "status" + (err ? " err" : ""); }
function show(step) {
  ORDER.forEach((s, i) => { $("step-" + s).hidden = s !== step; $("steps").children[i].className = i <= ORDER.indexOf(step) ? "done" : ""; });
  sessionStorage.setItem("slate-wizard-step", step);
  const first = $("step-" + step).querySelector("input:not([type=checkbox]),button");
  if (first) first.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  if (step === "units") renderUnits();
  if (step === "starter") renderStarters();
  if (step === "display") renderDisplays();
}
async function api(path, method, body) {
  const res = await fetch(path, { method: method || "GET", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (data.issues || []).map((i) => i.message).join("; ") || "Request failed (" + res.status + ")");
  return data;
}
async function putConfig(next) { const r = await api("/api/config", "PUT", next); config = r.config; }

async function start() {
  session = await api("/api/session");
  if (!session.hasAdmin) {
    $("code-wrap").hidden = !session.needsCode;
    $("setup-code").value = new URLSearchParams(location.search).get("code") || "";
    return show("admin");
  }
  if (!session.authenticated) {
    $("admin-title").textContent = "Sign in to continue setup";
    $("admin-sub").textContent = "Use the admin password you created.";
    $("confirm-wrap").hidden = true;
    $("admin-pw").autocomplete = "current-password";
    return show("admin");
  }
  config = await api("/api/config");
  const saved = sessionStorage.getItem("slate-wizard-step");
  show(saved && saved !== "admin" ? saved : "location");
}

$("admin-form").onsubmit = async (e) => {
  e.preventDefault();
  const password = $("admin-pw").value;
  try {
    if (!session.hasAdmin) {
      if (password.length < session.minPassword) return status("admin-status", "Use at least " + session.minPassword + " characters.", true);
      if (password !== $("admin-pw2").value) return status("admin-status", "The passwords don't match.", true);
      await api("/api/setup/admin", "POST", { password, code: $("setup-code").value });
    } else {
      await api("/api/login", "POST", { password });
    }
    session = await api("/api/session");
    config = await api("/api/config");
    status("admin-status", "");
    show("location");
  } catch (err) { status("admin-status", err.message, true); }
};

// Location
let picked = null;
const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
function pick(p) {
  picked = p;
  $("loc-picked").textContent = p ? "Selected: " + p.label + " (" + p.lat.toFixed(3) + ", " + p.lon.toFixed(3) + ")" : "";
  if (p) { $("loc-lat").value = p.lat; $("loc-lon").value = p.lon; $("loc-name").value = p.name; $("loc-tz").value = p.timezone || browserTz; }
}
let searchTimer;
$("loc-q").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value;
  searchTimer = setTimeout(async () => {
    const box = $("loc-results"); box.innerHTML = ""; status("loc-status", "");
    if (q.trim().length < 2) return;
    const res = await fetch("/api/geocode?q=" + encodeURIComponent(q));
    const body = await res.json().catch(() => ({ results: [] }));
    if (body.error) { status("loc-status", body.error, true); $("loc-manual").open = true; }
    for (const r of body.results || []) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = r.name;
      b.onclick = () => { pick({ label: r.name, name: r.name.split(",")[0], lat: r.lat, lon: r.lon, timezone: r.timezone }); box.innerHTML = ""; };
      box.append(b);
    }
  }, 300);
});
// Browsers only offer geolocation in a secure context; phones on the LAN use plain http.
if (window.isSecureContext && navigator.geolocation) $("loc-geo").hidden = false; else $("loc-geo-note").hidden = false;
$("loc-geo").onclick = () => navigator.geolocation.getCurrentPosition(
  (p) => pick({ label: "This device's location", name: "Home", lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), timezone: browserTz }),
  () => status("loc-status", "Location permission was denied. Search for your city instead.", true),
);
$("loc-go").onclick = async () => {
  const lat = parseFloat($("loc-lat").value), lon = parseFloat($("loc-lon").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return status("loc-status", "Search for a city, or enter a latitude and longitude.", true);
  try {
    await putConfig({ ...config, location: { name: $("loc-name").value.trim(), lat, lon, timezone: $("loc-tz").value.trim() || browserTz } });
    show("units");
  } catch (err) { status("loc-status", err.message, true); }
};
$("loc-skip").onclick = () => show("units");

// Units and night
function localeDefaults() {
  const region = (navigator.language.split("-")[1] || "").toUpperCase();
  const fahrenheit = ["US", "LR", "MM", "BS", "BZ", "KY", "PW"].includes(region);
  const cycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
  return { temperature: fahrenheit ? "fahrenheit" : "celsius", time: cycle === "h11" || cycle === "h12" ? "12h" : "24h" };
}
function inWindow(from, to) {
  const tz = (config.location && config.location.timezone) || browserTz;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
  const now = +parts.find((p) => p.type === "hour").value * 60 + +parts.find((p) => p.type === "minute").value;
  const m = (s) => +s.split(":")[0] * 60 + +s.split(":")[1];
  const a = m(from), b = m(to);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}
function nightNote() {
  const on = $("n-enabled").checked;
  $("n-times").style.opacity = on ? 1 : 0.5;
  $("n-note").textContent = on && inWindow($("n-from").value, $("n-to").value)
    ? "It's inside that window right now, so the display will start dimmed. The screen stays on either way."
    : "The screen stays on at night so the device doesn't go to sleep. You can change this later.";
}
let unitsRendered = false;
function renderUnits() {
  if (unitsRendered) return; unitsRendered = true;
  const d = localeDefaults();
  $("u-temp").value = d.temperature; $("u-time").value = d.time;
  const first = Object.values(config.displays)[0];
  if (first) { $("n-enabled").checked = first.night.enabled; $("n-from").value = first.night.from; $("n-to").value = first.night.to; }
  nightNote();
}
["n-enabled", "n-from", "n-to"].forEach((id) => $(id).addEventListener("input", nightNote));
$("units-go").onclick = async () => {
  const night = { enabled: $("n-enabled").checked, from: $("n-from").value || "22:00", to: $("n-to").value || "07:00" };
  const displays = Object.fromEntries(Object.entries(config.displays).map(([id, d]) => [id, { ...d, night: { ...d.night, ...night, theme: d.night.theme || "ink-dark" } }]));
  try {
    await putConfig({ ...config, units: { temperature: $("u-temp").value, time: $("u-time").value }, displays });
    show("starter");
  } catch (err) { status("units-status", err.message, true); }
};

// Starter screens
let starters;
async function renderStarters() {
  if (!starters) starters = await api("/api/starters");
  const box = $("starters"); box.innerHTML = "";
  const current = (config.screens.home && config.screens.home.name) || "";
  starters.starters.forEach((s, i) => {
    const t = starters.templates.find((t) => t.id === s.layout);
    const card = document.createElement("label"); card.className = "card";
    const radio = document.createElement("input"); radio.type = "radio"; radio.name = "starter"; radio.value = s.id;
    radio.checked = current ? s.name === current : i === 0;
    const mini = document.createElement("div"); mini.className = "mini"; mini.setAttribute("aria-hidden", "true");
    t.slots.forEach((slot, j) => {
      const cell = document.createElement("span"); cell.textContent = s.widgets[j] || "";
      cell.style.gridColumn = slot.x + 1 + " / span " + slot.w; cell.style.gridRow = slot.y + 1 + " / span " + slot.h;
      mini.append(cell);
    });
    const text = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = s.name;
    const desc = document.createElement("small"); desc.textContent = s.description;
    text.append(name, desc);
    card.append(radio, mini, text); box.append(card);
  });
}
$("starter-go").onclick = async () => {
  const sel = document.querySelector("input[name=starter]:checked");
  if (!sel) return status("starter-status", "Pick a starter screen.", true);
  try { const r = await api("/api/setup/starter", "POST", { starter: sel.value }); config = r.config; show("display"); }
  catch (err) { status("starter-status", err.message, true); }
};

// Displays
const isLocalHost = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
$("same-machine").checked = isLocalHost;
$("same-machine").onchange = renderDisplays;
function baseUrls() {
  const lan = isLocalHost ? (session.lanUrls || [])[0] || location.origin : location.origin;
  return { lan, display: $("same-machine").checked ? "http://localhost:" + (location.port || "80") : lan };
}
function commands(url) {
  const q = "'" + url.replace(/'/g, "''") + "'";
  return [
    ["Windows 11 (Edge kiosk at sign-in; run in an admin PowerShell)", "irm " + RAW + "/deploy/windows/setup-kiosk.ps1 -OutFile $env:TEMP\\\\slate-kiosk.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\\\\slate-kiosk.ps1 -Url " + q],
    ["macOS (Chrome full screen)", "open -na 'Google Chrome' --args --kiosk --app=" + q],
    ["Linux / Raspberry Pi (Chromium kiosk)", "chromium --kiosk --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required " + q],
  ];
}
function renderDisplays() {
  const list = $("display-list"); list.innerHTML = "";
  const { lan, display } = baseUrls();
  for (const [id, d] of Object.entries(config.displays)) {
    const path = "/d/" + encodeURIComponent(d.token);
    const wrap = document.createElement("div"); wrap.className = "display"; wrap.dataset.display = id;
    const img = document.createElement("img"); img.className = "qr"; img.alt = "QR code for " + (d.name || id);
    img.src = "/api/qr.svg?text=" + encodeURIComponent(lan + path);
    const info = document.createElement("div"); info.className = "info";
    const h = document.createElement("strong"); h.textContent = d.name || id;
    const url = document.createElement("pre"); url.textContent = display + path; url.dataset.url = "";
    const open = document.createElement("a"); open.href = path; open.textContent = "Open on this device"; open.className = "open-here";
    const scan = document.createElement("p"); scan.className = "note"; scan.textContent = "Or scan the code with the display device's camera.";
    info.append(h, url, open, scan);
    const det = document.createElement("details"); const sum = document.createElement("summary"); sum.textContent = "Kiosk setup commands"; det.append(sum);
    for (const [label, cmd] of commands(display + path)) {
      const l = document.createElement("label"); l.textContent = label;
      const pre = document.createElement("pre"); pre.textContent = cmd;
      const copy = document.createElement("button"); copy.type = "button"; copy.className = "secondary"; copy.textContent = "Copy";
      copy.onclick = () => navigator.clipboard ? navigator.clipboard.writeText(cmd).then(() => (copy.textContent = "Copied")) : window.prompt("Copy this command", cmd);
      det.append(l, pre, copy);
    }
    info.append(det);
    wrap.append(img, info); list.append(wrap);
  }
}
$("add-form").onsubmit = async (e) => {
  e.preventDefault();
  try { const r = await api("/api/displays", "POST", { name: $("add-name").value }); config = r.config; $("add-name").value = ""; renderDisplays(); status("display-status", "Display added."); }
  catch (err) { status("display-status", err.message, true); }
};
$("finish").onclick = async () => {
  try { await api("/api/setup/complete", "POST", {}); sessionStorage.removeItem("slate-wizard-step"); location.href = "/"; }
  catch (err) { status("display-status", err.message, true); }
};

start().catch((err) => { show("admin"); status("admin-status", "Couldn't reach the Slate server: " + err.message, true); });
</script>
</body></html>`;
}
