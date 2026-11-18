/** Theme = CSS custom properties. The full theme system and editor land in Phase 2. */
export const THEMES: Record<string, Record<string, string>> = {
  paper: {
    "--paper": "#f4f2ec",
    "--ink": "#1b1a17",
    "--muted": "#6b6860",
    "--accent": "#b3261e",
    "--rule": "#1b1a17",
  },
  "ink-dark": {
    "--paper": "#0d0d0c",
    "--ink": "#d8d6cf",
    "--muted": "#8a877f",
    "--accent": "#e0715f",
    "--rule": "#3a3934",
  },
};

export function themeCss(): string {
  return Object.entries(THEMES)
    .map(([name, vars]) => {
      const body = Object.entries(vars)
        .map(([k, v]) => `${k}:${v}`)
        .join(";");
      const selector = name === "paper" ? `:root,[data-theme="paper"]` : `[data-theme="${name}"]`;
      return `${selector}{${body}}`;
    })
    .join("\n");
}

/**
 * Subset of TRMNL Framework class names so recipes and first-party widgets share
 * markup. The full framework build is ~15 MB of CSS, too heavy to inline per widget.
 */
export const BASE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--paper);color:var(--ink);overflow:hidden}
body{font:16px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased}
.view{position:relative;height:100%;display:flex;flex-direction:column;padding:12px}
.view>.layout{flex:1;min-height:0}
.layout{display:flex;gap:8px;align-items:flex-start}
.layout--row{flex-direction:row;align-items:center;flex-wrap:wrap}
.layout--col{flex-direction:column}
.layout--center{align-items:center;justify-content:center;text-align:center;height:100%}
.flex{display:flex}.flex--row{flex-direction:row}.flex--col{flex-direction:column}
.gap--small{gap:4px}.gap--large{gap:20px}
.item{padding:4px 0}
.value{font-weight:700;font-variant-numeric:tabular-nums;font-size:1.6em;line-height:1}
.value--small{font-size:1.2em}.value--large{font-size:2.2em}.value--xlarge{font-size:3.2em}.value--xxlarge{font-size:4.8em}
.title{font-weight:700;font-size:1.1em}
.label{color:var(--muted);font-size:.95em}.label--small{font-size:.8em}
.title_bar{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:2px solid var(--rule);padding-top:6px;margin-top:8px;font-size:.85em}
.title_bar .title{font-size:1em}.title_bar .instance{color:var(--muted)}
`;
