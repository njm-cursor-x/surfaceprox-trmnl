# Writing a plugin

A **plugin** is a folder in `plugins/` (later: installed into `<data dir>/plugins/`).
It can contain any mix of:

```
my-plugin/
  package.json             name + version (optional)
  settings.yml             a widget, in TRMNL's settings.yml format plus a `slate:` block
  src/full.liquid          one template per TRMNL layout you support
  src/half_horizontal.liquid
  src/half_vertical.liquid
  src/quadrant.liquid
  src/shared.liquid        {% template name %} partials, used with {% render "name" %}
  client.js                optional: runs inside the widget's sandboxed iframe
  style.css                optional
  widgets/<id>/...         more widgets, same layout as above
  connector.ts             optional: default-export defineConnector(...) (or an array)
  extensions/<point>/<id>/ optional: contributions to an extension point (template.liquid, client.js, style.css)
```

A plain TRMNL recipe (`settings.yml` + `src/*.liquid`) already loads as a widget.
Slate ignores TRMNL keys it doesn't use.

## Connector

```ts
import { defineConnector, z } from "@slate/sdk";

export default defineConnector({
  id: "open-meteo",
  config: z.object({ lat: z.coerce.number(), lon: z.coerce.number() }),
  hosts: ["api.open-meteo.com"], // the injected fetch can reach only these hosts
  refresh: { every: "15m", min: "5m" },
  quota: { perDay: 9000 },
  async fetch({ config, fetch, signal }) {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${config.lat}&longitude=${config.lon}`,
      { signal },
    );
    return res.json();
  },
});
```

The server caches results per connector + config, so widgets with the same config share
one fetch. Widgets keep rendering the last good data while a refresh is pending or has
failed. The server also enforces `quota` and backs off on HTTP 429/503.

Test against recorded fixtures:

```ts
import { fixtureFetch, testConnector } from "@slate/sdk/testing";
const data = await testConnector(connector, {
  config: { lat: 1, lon: 2 },
  fetch: fixtureFetch({ "https://api.open-meteo.com/v1/forecast": fixture }),
});
```

## Widget manifest (`settings.yml`)

```yaml
name: Weather
custom_fields: # TRMNL custom fields -> instance settings
  - { keyname: location_name, field_type: string, optional: true }
slate:
  connectors:
    weather:
      use: open-meteo
      with: # resolved per instance from settings, location, and units
        lat: "{{ settings.lat | default: location.lat }}"
        lon: "{{ settings.lon | default: location.lon }}"
  sizes: # in 12x8 grid units; scaled for other grid densities
    min: { w: 2, h: 2 }
    max: { w: 12, h: 8 }
    default: { w: 4, h: 3 }
    presets: { small: { w: 3, h: 2 }, wide: { w: 8, h: 3 } }
    aspect: { min: 0.5, max: 4 }
  templates: # optional overrides of the slot-shape mapping
    "w<=3": quadrant
  extension_points: [clock.face]
```

The template variant comes from the slot's shape: wide slots use `half_horizontal`, tall
slots use `half_vertical`, large slots use `full`, and small slots use `quadrant`. If the
widget doesn't ship that variant, the closest one it does ship is used.

Template variables: `data.<alias>` (connector output),
`meta.<alias>.{fetchedAt,stale,error,unconfigured}`, `settings`, `location`, `units`,
`instance`, `slot`, and TRMNL's `trmnl.plugin_settings` and `trmnl.user.time_zone`.

## Sandbox

Each widget renders in an `<iframe sandbox="allow-scripts">` with a CSP of
`default-src 'none'`, so `client.js` can't make network requests or reach the display
page. Style with theme tokens (`var(--ink)`, `var(--paper)`, `var(--muted)`,
`var(--accent)`) so night and dark themes apply.
