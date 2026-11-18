import type { GridSize, LayoutName } from "@slate/sdk";
import { toBaseUnits, type GridLayout } from "./grid.ts";

const FALLBACKS: Record<LayoutName, LayoutName[]> = {
  full: ["full", "half_horizontal", "half_vertical", "quadrant"],
  half_horizontal: ["half_horizontal", "full", "quadrant", "half_vertical"],
  half_vertical: ["half_vertical", "full", "quadrant", "half_horizontal"],
  quadrant: ["quadrant", "half_horizontal", "half_vertical", "full"],
};

/** The TRMNL variant whose shape best matches a slot, before availability is considered. */
export function idealTemplate(
  slot: GridSize,
  layout: Pick<GridLayout, "cols" | "rows">,
): LayoutName {
  const fw = slot.w / layout.cols;
  const fh = slot.h / layout.rows;
  const ratio = fw / fh;
  if (ratio >= 1.5) return fw >= 0.5 ? "half_horizontal" : "quadrant";
  if (ratio <= 1 / 1.5) return fh >= 0.5 ? "half_vertical" : "quadrant";
  return fw * fh >= 0.5 ? "full" : "quadrant";
}

type Rule = { dim: "w" | "h"; op: "<" | "<=" | ">" | ">=" | "=="; value: number };

function parseRule(expr: string): Rule[] {
  return expr.split(/\s*(?:,|&&)\s*/).map((part) => {
    const m = /^(w|h)\s*(<=|>=|==|<|>)\s*(\d+(?:\.\d+)?)$/.exec(part.trim());
    if (!m) throw new Error(`Invalid template rule "${expr}"`);
    return { dim: m[1] as Rule["dim"], op: m[2] as Rule["op"], value: Number(m[3]) };
  });
}

function matches(rules: Rule[], size: GridSize): boolean {
  return rules.every(({ dim, op, value }) => {
    const v = size[dim];
    switch (op) {
      case "<":
        return v < value;
      case "<=":
        return v <= value;
      case ">":
        return v > value;
      case ">=":
        return v >= value;
      case "==":
        return v === value;
    }
  });
}

/**
 * Picks the template variant for a slot: plugin rules first (in 12x8 units), then the
 * closest TRMNL shape, falling back to whatever layouts the widget ships.
 */
export function pickTemplate(
  slot: GridSize,
  layout: Pick<GridLayout, "cols" | "rows">,
  available: readonly LayoutName[],
  rules: Record<string, LayoutName> = {},
): LayoutName {
  if (available.length === 0) throw new Error("Widget has no templates");
  const base = toBaseUnits(slot, layout.cols, layout.rows);
  for (const [expr, target] of Object.entries(rules)) {
    if (available.includes(target) && matches(parseRule(expr), base)) return target;
  }
  const ideal = idealTemplate(slot, layout);
  return FALLBACKS[ideal].find((l) => available.includes(l)) ?? available[0]!;
}
