#!/usr/bin/env node
// Rebuilds vendor/trmnl-framework.css from the pinned upstream release.
//   pnpm --filter @slate/framework vendor
// To move the pin: change VERSION, COMMIT, and SHA256 together, rerun, and review the diff.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

export const VERSION = "3.4.6";
const COMMIT = "07a0b39e41c9a702e3f21834853d68720f96c170";
const SHA256 = "3136fb2569c544a17a8ddce196c0058b53f46c3e1e0c1458c87441bc0ffb6f4a";
const SOURCE = `https://raw.githubusercontent.com/usetrmnl/trmnl-framework/${COMMIT}/public/css/${VERSION}/plugins.css`;

// What a browser widget slot doesn't need: per-device screen variants, responsive and
// orientation/bit-depth prefixed variants (`md:`, `portrait:`, `1bit:`), the dark theme
// (Slate themes replace it), mashup chrome (Slate's grid replaces it), components that
// need TRMNL's JS runtime, and the long tail of colour and sizing utilities.
const DROP = new RegExp(
  [
    String.raw`\.screen--`,
    String.raw`\\:`,
    String.raw`\.dark\b`,
    String.raw`\.mashup`,
    String.raw`\.table`,
    String.raw`\.chart`,
    String.raw`\.map\b`,
    String.raw`\.map__`,
    String.raw`\.richtext`,
    String.raw`\.progress`,
    String.raw`\.image`,
    String.raw`\.text-stroke`,
    String.raw`\.dot\b`,
    String.raw`\.track\b`,
    String.raw`\.bg-`,
    String.raw`\.outline`,
    String.raw`\.inverse`,
    String.raw`\.typeface`,
    String.raw`\.border--`,
    String.raw`\.rounded`,
    String.raw`\.clamp`,
    String.raw`\.fill`,
    String.raw`\.stroke`,
    String.raw`\[data-`,
    String.raw`\.text--[a-z]+-\d+`,
    String.raw`\.(?:w|h|min-w|max-w|min-h|max-h)--(?!full\b)`,
  ].join("|"),
);

const varRefs = (value) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

export function trim(css) {
  const root = postcss.parse(css);
  // Fonts point at TRMNL-hosted URLs; widgets fall back to system fonts.
  root.walkAtRules((a) => {
    if (a.name === "font-face" || a.name === "property") a.remove();
  });
  root.walkRules((rule) => {
    const keep = rule.selectors.filter((s) => !DROP.test(s));
    if (keep.length === 0) rule.remove();
    else rule.selectors = keep;
  });

  // Keep only custom properties that surviving declarations reference, transitively.
  const used = new Set();
  const defs = new Map();
  root.walkDecls((d) => {
    if (d.prop.startsWith("--")) {
      if (!defs.has(d.prop)) defs.set(d.prop, []);
      defs.get(d.prop).push(d);
    } else varRefs(d.value).forEach((v) => used.add(v));
  });
  const queue = [...used];
  while (queue.length) {
    for (const d of defs.get(queue.pop()) ?? []) {
      for (const ref of varRefs(d.value)) {
        if (!used.has(ref)) {
          used.add(ref);
          queue.push(ref);
        }
      }
    }
  }
  root.walkDecls((d) => {
    if (d.prop.startsWith("--") && !used.has(d.prop)) d.remove();
  });

  for (let changed = true; changed;) {
    changed = false;
    root.walkRules((r) => {
      if (r.nodes.length === 0) {
        r.remove();
        changed = true;
      }
    });
    root.walkAtRules((a) => {
      if (a.nodes && a.nodes.length === 0) {
        a.remove();
        changed = true;
      }
    });
  }
  return root.toString();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = await globalThis.fetch(SOURCE);
  if (!res.ok) throw new Error(`GET ${SOURCE}: ${res.status}`);
  const css = await res.text();
  const digest = createHash("sha256").update(css).digest("hex");
  if (digest !== SHA256) throw new Error(`Checksum mismatch: got ${digest}, pinned ${SHA256}`);
  const out = trim(css);
  const header = `/*! TRMNL Framework ${VERSION} (usetrmnl/trmnl-framework@${COMMIT.slice(0, 12)}), trimmed for Slate.
 * Upstream: ${SOURCE}
 * Upstream sha256: ${SHA256}
 * Copyright (c) 2026 TRMNL. MIT License. Regenerate with: pnpm --filter @slate/framework vendor
 */\n`;
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "trmnl-framework.css");
  writeFileSync(file, header + out + "\n");
  console.log(
    `Wrote ${file}: ${(out.length / 1024).toFixed(0)} KB (upstream ${(css.length / 1024 / 1024).toFixed(1)} MB)`,
  );
}
