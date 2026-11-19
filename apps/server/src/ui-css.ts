/** Shared styles for the config page and the setup wizard (phone-first). */
export const UI_CSS = `
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
`;
