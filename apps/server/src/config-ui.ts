/**
 * Phase 1a config UI skeleton: location, units, night mode, display links, health, and
 * a raw YAML editor. The full phone PWA with the grid editor replaces this in Phase 2.
 */
export function configUiHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Slate config</title>
<style>
:root{--paper:#f4f2ec;--ink:#1b1a17;--muted:#6b6860;--accent:#b3261e;--card:#ebe8df;--line:#d3cfc3}
@media (prefers-color-scheme:dark){:root{--paper:#121210;--ink:#e2e0d9;--muted:#9a978e;--accent:#e0715f;--card:#1c1b18;--line:#34332e}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:16px 16px 64px}
h1{font-size:1.5rem;margin:8px 0 4px}h2{font-size:1.05rem;margin:0 0 12px}
p.sub{color:var(--muted);margin:0 0 16px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
label{display:block;font-size:.9rem;color:var(--muted);margin:10px 0 4px}
input,select,textarea,button{font:inherit;color:inherit}
input,select,textarea{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--paper)}
input[type=checkbox]{width:auto;margin-right:8px}input[type=range]{padding:0}
textarea{min-height:320px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85rem}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
button{padding:10px 16px;border-radius:8px;border:1px solid var(--ink);background:var(--ink);color:var(--paper);cursor:pointer;min-height:44px}
button.secondary{background:transparent;color:var(--ink)}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.results button{display:block;width:100%;text-align:left;margin-top:6px;background:var(--paper);color:var(--ink);border-color:var(--line)}
.status{min-height:1.4em;font-size:.9rem;margin-top:8px}.status.err{color:var(--accent)}
ul{padding-left:18px;margin:0}li{margin:4px 0}code{font-size:.85em;word-break:break-all}
a{color:inherit}
</style></head>
<body><main>
<h1>Slate</h1>
<p class="sub">Configure this display from any browser on your network.</p>

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
  <div class="actions"><button id="loc-save">Save location</button><button class="secondary" id="loc-geo">Use this device's location</button></div>
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
  for (const c of h.connectors) { const li = document.createElement("li"); li.textContent = c.connector + ": " + (c.error ? "error: " + c.error : c.fetchedAt ? "updated " + new Date(c.fetchedAt).toLocaleTimeString() : "waiting"); ul.append(li); }
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
$("loc-geo").onclick = () => {
  if (!navigator.geolocation) return status("loc-status", "This browser can't share its location; search for a city instead.", true);
  navigator.geolocation.getCurrentPosition(
    (p) => { $("loc-lat").value = p.coords.latitude.toFixed(4); $("loc-lon").value = p.coords.longitude.toFixed(4); },
    () => status("loc-status", "Location permission denied or unavailable over plain http; search for a city instead.", true),
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
load().catch((e) => status("yaml-status", "Couldn't reach the server: " + e.message, true));
</script>
</body></html>`;
}
