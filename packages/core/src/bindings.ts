const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
const ANY = /\{\{\s*([^}]+?)\s*\}\}/g;

function lookup(scope: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, scope);
}

function literal(token: string): { value: unknown } | null {
  if (/^-?\d+(\.\d+)?$/.test(token)) return { value: Number(token) };
  const quoted = /^(["'])(.*)\1$/.exec(token);
  if (quoted) return { value: quoted[2] };
  if (token === "true" || token === "false") return { value: token === "true" };
  if (token === "nil" || token === "null") return { value: null };
  return null;
}

/** Evaluates `path` or `path | default: other` where `other` is a path or literal. */
function evaluate(expr: string, scope: unknown): unknown {
  const [head, ...filters] = expr.split("|").map((s) => s.trim());
  let value = literal(head!)?.value ?? lookup(scope, head!);
  for (const f of filters) {
    const m = /^default\s*:\s*(.+)$/.exec(f);
    if (!m) throw new Error(`Unsupported filter in binding: "${f}"`);
    if (value === undefined || value === null || value === "") {
      const arg = m[1]!.trim();
      value = literal(arg)?.value ?? lookup(scope, arg);
    }
  }
  return value;
}

/**
 * Resolves a connector binding's `with` values against `{ settings, location, units }`.
 * A value that is exactly one `{{ expr }}` keeps its type (numbers stay numbers).
 */
export function resolveBinding(
  values: Record<string, unknown> = {},
  scope: Record<string, unknown>,
) {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(values)) {
    if (typeof raw !== "string") {
      out[key] = raw;
      continue;
    }
    const whole = WHOLE.exec(raw);
    out[key] = whole
      ? evaluate(whole[1]!, scope)
      : raw.replace(ANY, (_, expr: string) => String(evaluate(expr, scope) ?? ""));
  }
  return out;
}
