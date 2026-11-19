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

## Preview with `slate dev`

```bash
slate dev plugins/my-plugin                    # or: pnpm slate dev plugins/my-plugin
slate dev plugins/weather --lat 45.5 --lon=-122.7 --tz America/Los_Angeles
slate dev plugins/weather --fixture https://api.open-meteo.com/v1/forecast=test/fixtures/forecast.json
```

It opens http://localhost:8788 with every widget in all four TRMNL layouts (`full`,
`half_horizontal`, `half_vertical`, `quadrant`), at Surface Pro X (1440×960) and TRMNL
OG (800×480) sizes. Connectors run for real; `--fixture <url>=<file.json>` answers
requests to that URL from a file instead. Saving any file in the plugin reloads the
preview. Pass a folder of plugins to preview them all.

## Styles: TRMNL Framework or Slate

Plain TRMNL recipes render with the [TRMNL Framework](https://github.com/usetrmnl/trmnl-framework)
CSS (pinned to 3.4.6, trimmed to the layout, typography, spacing, grid, flex, and
title-bar classes, about 160 KB). Each widget gets `<html class="trmnl">`,
`<div class="screen"><div class="view view--full">` (or the layout in use), and
`--device-ui-scale` sized to its slot. Colours map to Slate's theme tokens, so night and
dark themes still apply. Charts, maps, tables, and rich text aren't included yet.

Widgets with a `slate:` block use Slate's smaller base styles instead. Either can choose
with `slate: { framework: trmnl }` or `slate: { framework: slate }`. To update the vendored
CSS, change the pinned version and checksum in `packages/framework/scripts/vendor.mjs`
and run `pnpm --filter @slate/framework vendor`.

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

Output is HTML-escaped: `{{ data.name }}` shows `<b>` as text. This differs from TRMNL,
which doesn't escape. To output trusted HTML, use `{{ value | raw }}`. Widgets run in a
sandbox either way; escaping stops connector data from changing the widget's markup.

Template variables: `data.<alias>` (connector output),
`meta.<alias>.{fetchedAt,stale,error,unconfigured}`, `settings`, `location`, `units`,
`instance`, `slot`, and TRMNL's `trmnl.plugin_settings` and `trmnl.user.time_zone`.

## Sandbox

Each widget renders in an `<iframe sandbox="allow-scripts">` with a CSP of
`default-src 'none'`, so `client.js` can't make network requests or reach the display
page. TRMNL Framework widgets also load one stylesheet from the Slate server. Style with theme tokens (`var(--ink)`, `var(--paper)`, `var(--muted)`,
`var(--accent)`) so night and dark themes apply.
