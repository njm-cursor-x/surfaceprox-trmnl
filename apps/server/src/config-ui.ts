import { UI_CSS } from "./ui-css.ts";

/**
 * Phase 1a config UI skeleton: location, units, night mode, display links, health, and
 * a raw YAML editor. The full phone PWA with the grid editor replaces this in Phase 2.
 */
export function configUiHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Slate config</title>
<style>${UI_CSS}</style></head>
<body><main>
<h1>Slate</h1>
<p class="sub">Configure this display from any browser on your network.</p>

<section id="login" hidden><h2>Sign in</h2>
  <form id="login-form">
    <label for="login-pw">Admin password</label><input id="login-pw" type="password" autocomplete="current-password" required>
    <div class="actions"><button type="submit">Sign in</button></div>
  </form>
  <div class="status" id="login-status"></div>
</section>
<div id="app" hidden>
<p class="sub"><a href="/setup">Run the setup wizard again</a> · <a href="#" id="logout">Sign out</a></p>

<section id="displays"><h2>Displays</h2><ul id="display-list"></ul></section>

<section><h2>Location</h2>
  <p class="sub" id="loc-current">Not set. Weather needs a location.</p>
  <label for="loc-q">Search for a city</label>
  <input id="loc-q" placeholder="e.g. Portland" autocomplete="off">
  <div class="results" id="loc-results"></div>
  <div class="row">
    <div><label for="loc-lat">Latitude</label><input id="loc-lat" inputmode="decimal"></div>
    <div><label for="loc-lon">Longitude</label><input id="loc-lon" inputmode="decimal"></div>
  </div>
  <label for="loc-name">Label</label><input id="loc-name">
  <label for="loc-tz">Time zone</label><input id="loc-tz" placeholder="e.g. America/Los_Angeles">
  <div class="actions"><button id="loc-save">Save location</button><button class="secondary" id="loc-geo" hidden>Use this device's location</button></div>
  <p class="sub" id="loc-geo-note" hidden>Sharing this device's location needs HTTPS or localhost, so it's off here. Search for your city instead.</p>
  <div class="status" id="loc-status"></div>
</section>

<section><h2>Units</h2>
  <div class="row">
    <div><label for="u-temp">Temperature</label><select id="u-temp"><option value="fahrenheit">°F</option><option value="celsius">°C</option></select></div>
    <div><label for="u-time">Time</label><select id="u-time"><option value="12h">12-hour</option><option value="24h">24-hour</option></select></div>
  </div>
  <div class="actions"><button id="u-save">Save units</button></div>
  <div class="status" id="u-status"></div>
</section>

<section><h2>Night mode</h2>
  <p class="sub">Dims and/or switches to a dark theme on a schedule. The screen stays on so the device doesn't sleep.</p>
  <label for="n-display">Display</label><select id="n-display"></select>
  <label><input type="checkbox" id="n-enabled">Enabled</label>
  <div class="row">
    <div><label for="n-from">Starts</label><input type="time" id="n-from"></div>
    <div><label for="n-to">Ends</label><input type="time" id="n-to"></div>
  </div>
  <label for="n-dim">Dim: <span id="n-dim-val"></span></label><input type="range" id="n-dim" min="0" max="0.9" step="0.05">
  <label for="n-theme">Night theme</label><select id="n-theme"><option value="">Keep day theme</option><option value="ink-dark">Dark (ink-dark)</option><option value="paper">Paper</option></select>
  <div class="actions"><button id="n-save">Save night mode</button></div>
  <div class="status" id="n-status"></div>
</section>

<section><h2>Plugins &amp; health</h2><ul id="health"></ul></section>

<section><h2>Advanced: config.yml</h2>
  <textarea id="yaml" spellcheck="false" aria-label="config.yml"></textarea>
  <div class="actions"><button id="yaml-save">Save YAML</button><button class="secondary" id="yaml-reload">Reload</button></div>
  <div class="status" id="yaml-status"></div>
</section>
</div>
</main>
<script>
const $ = (id) => document.getElementById(id);
let config;
function status(id, msg, err) { const el = $(id); el.textContent = msg; el.className = "status" + (err ? " err" : ""); }
function issuesText(body) { return (body.issues || []).map((i) => (i.path ? i.path + ": " : "") + i.message).join("; ") || body.error || "Save failed"; }
async function put(next, statusId) {
  const res = await fetch("/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
  const body = await res.json();
  if (!res.ok) return status(statusId, issuesText(body), true);
  config = body.config; render(); status(statusId, "Saved. Displays update automatically.");
}
function render() {
  const list = $("display-list"); list.innerHTML = "";
  const sel = $("n-display"); const prev = sel.value; sel.innerHTML = "";
  for (const [id, d] of Object.entries(config.displays)) {
    const url = location.origin + "/d/" + encodeURIComponent(d.token);
    const li = document.createElement("li");
    const a = document.createElement("a"); a.href = url; a.textContent = d.name || id; li.append(a, " ");
    const code = document.createElement("code"); code.textContent = url; li.append(code); list.append(li);
    const o = document.createElement("option"); o.value = id; o.textContent = d.name || id; sel.append(o);
  }
  if (prev && config.displays[prev]) sel.value = prev;
  const loc = config.location;
  $("loc-current").textContent = loc ? (loc.name || "Custom") + " (" + loc.lat.toFixed(3) + ", " + loc.lon.toFixed(3) + ")" : "Not set. Weather needs a location.";
  $("loc-lat").value = loc ? loc.lat : ""; $("loc-lon").value = loc ? loc.lon : "";
  $("loc-name").value = loc ? loc.name : ""; $("loc-tz").value = (loc && loc.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone;
  $("u-temp").value = config.units.temperature; $("u-time").value = config.units.time;
  renderNight();
}
function renderNight() {
  const d = config.displays[$("n-display").value]; if (!d) return;
  $("n-enabled").checked = d.night.enabled; $("n-from").value = d.night.from; $("n-to").value = d.night.to;
  $("n-dim").value = d.night.dim; $("n-dim-val").textContent = Math.round(d.night.dim * 100) + "%";
  $("n-theme").value = d.night.theme || "";
}
async function load() {
  config = await (await fetch("/api/config")).json(); render();
  $("yaml").value = await (await fetch("/api/config.yml")).text();
  const h = await (await fetch("/api/health")).json(); const ul = $("health"); ul.innerHTML = "";
  for (const p of h.plugins) { const li = document.createElement("li"); li.textContent = p.name + ": " + [...p.widgets.map((w) => "widget " + w), ...p.connectors.map((c) => "connector " + c)].join(", "); ul.append(li); }
  for (const e of h.loadErrors) { const li = document.createElement("li"); li.textContent = "Failed to load " + e.dir + ": " + e.error; ul.append(li); }
  for (const c of h.connectors) { const li = document.createElement("li"); li.textContent = c.connector + ": " + (c.error ? c.error + " (" + c.detail + ")" : c.fetchedAt ? "updated " + new Date(c.fetchedAt).toLocaleTimeString() : "waiting"); ul.append(li); }
}
let searchTimer;
$("loc-q").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const res = await fetch("/api/geocode?q=" + encodeURIComponent(e.target.value)); const body = await res.json();
    const box = $("loc-results"); box.innerHTML = "";
    if (body.error) status("loc-status", body.error, true);
    for (const r of body.results) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = r.name;
      b.onclick = () => { $("loc-lat").value = r.lat; $("loc-lon").value = r.lon; $("loc-name").value = r.name.split(",")[0]; if (r.timezone) $("loc-tz").value = r.timezone; box.innerHTML = ""; };
      box.append(b);
    }
  }, 300);
});
// Browsers only offer geolocation in a secure context; phones on the LAN use plain http.
if (window.isSecureContext && navigator.geolocation) $("loc-geo").hidden = false; else $("loc-geo-note").hidden = false;
$("loc-geo").onclick = () => {
  navigator.geolocation.getCurrentPosition(
    (p) => { $("loc-lat").value = p.coords.latitude.toFixed(4); $("loc-lon").value = p.coords.longitude.toFixed(4); },
    () => status("loc-status", "Location permission was denied; search for a city instead.", true),
  );
};
$("loc-save").onclick = () => {
  const lat = parseFloat($("loc-lat").value), lon = parseFloat($("loc-lon").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return status("loc-status", "Enter a latitude and longitude, or search for a city.", true);
  put({ ...config, location: { name: $("loc-name").value.trim(), lat, lon, timezone: $("loc-tz").value.trim() || undefined } }, "loc-status");
};
$("u-save").onclick = () => put({ ...config, units: { temperature: $("u-temp").value, time: $("u-time").value } }, "u-status");
$("n-display").onchange = renderNight;
$("n-dim").oninput = () => { $("n-dim-val").textContent = Math.round($("n-dim").value * 100) + "%"; };
$("n-save").onclick = () => {
  const id = $("n-display").value; const d = config.displays[id];
  const night = { enabled: $("n-enabled").checked, from: $("n-from").value, to: $("n-to").value, dim: Number($("n-dim").value), theme: $("n-theme").value || null };
  put({ ...config, displays: { ...config.displays, [id]: { ...d, night } } }, "n-status");
};
$("yaml-save").onclick = async () => {
  const res = await fetch("/api/config.yml", { method: "PUT", headers: { "content-type": "text/yaml" }, body: $("yaml").value });
  const body = await res.json();
  if (!res.ok) return status("yaml-status", issuesText(body), true);
  config = body.config; render(); status("yaml-status", "Saved.");
};
$("yaml-reload").onclick = load;
async function boot() {
  const session = await (await fetch("/api/session")).json();
  if (!session.hasAdmin) return (location.href = "/setup");
  $("login").hidden = session.authenticated; $("app").hidden = !session.authenticated;
  if (session.authenticated) await load();
  else $("login-pw").focus();
}
$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: $("login-pw").value }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return status("login-status", body.error || "Sign-in failed", true);
  $("login-pw").value = ""; boot();
};
$("logout").onclick = async (e) => { e.preventDefault(); await fetch("/api/logout", { method: "POST" }); boot(); };
boot().catch((e) => status("login-status", "Couldn't reach the server: " + e.message, true));
</script>
</body></html>`;
}
