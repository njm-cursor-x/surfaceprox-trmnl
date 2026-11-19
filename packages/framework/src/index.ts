import type { LayoutName } from "@slate/sdk";

/** Pinned upstream release; vendor/trmnl-framework.css is generated from it. */
export const FRAMEWORK_VERSION = "3.4.6";
export const FRAMEWORK_FILE = "trmnl-framework.css";

/** TRMNL OG (800x480) view sizes, the size recipes are designed for. */
export const TRMNL_VIEW_SIZES: Record<LayoutName, { w: number; h: number }> = {
  full: { w: 800, h: 480 },
  half_horizontal: { w: 800, h: 240 },
  half_vertical: { w: 400, h: 480 },
  quadrant: { w: 400, h: 240 },
};

/** Scale that fits a TRMNL view of `layout` into a slot of `px` CSS pixels. */
export function frameworkScale(layout: LayoutName, px: { w: number; h: number }): number {
  const ref = TRMNL_VIEW_SIZES[layout];
  const s = Math.min(px.w / ref.w, px.h / ref.h);
  return Math.max(0.5, Math.round(s * 100) / 100);
}

/**
 * Slate's adapter, appended after the vendored framework: each widget iframe *is* the
 * view, so every view size is the viewport; framework colours follow theme tokens so
 * night mode and dark themes apply to recipes too. Unlayered, so it beats the
 * framework's `@layer` rules.
 */
export const ADAPTER_CSS = `
html.trmnl,html.trmnl body{margin:0;height:100%;overflow:hidden;background:var(--paper);color:var(--ink)}
.trmnl .screen{--black:var(--ink);--white:var(--paper);--gray-30:var(--muted);--framework-text-primary:var(--ink);--framework-semantic-text-primary-text-color:var(--ink);--framework-semantic-text-primary-text-solid:var(--ink);--framework-semantic-text-inverse-text-color:var(--paper);--framework-canvas-text-color:var(--ink);--framework-canvas-text-solid:var(--ink);--framework-surface-bg:var(--paper);--framework-semantic-surface-bg-color:var(--paper);--screen-w:100vw;--screen-h:100vh;--full-w:100vw;--full-h:100vh;--half_horizontal-w:100vw;--half_horizontal-h:100vh;--half_vertical-w:100vw;--half_vertical-h:100vh;--quadrant-w:100vw;--quadrant-h:100vh;width:100vw;height:100vh;background:var(--paper);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.trmnl .screen *{font-family:inherit;-webkit-font-smoothing:inherit}
.trmnl .title_bar{border-top:2px solid var(--rule)}
`;
