import type { GridSize, SizeConstraints } from "@slate/sdk";

export const BASE_COLS = 12;
export const BASE_ROWS = 8;

export interface GridItem {
  instance: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridLayout {
  cols: number;
  rows: number;
  /** Gap between cells in CSS pixels at the display's resolution. */
  gap?: number;
  items: GridItem[];
}

export interface LayoutIssue {
  instance?: string;
  code: "bounds" | "overlap" | "too-small" | "too-large" | "aspect" | "duplicate" | "invalid";
  message: string;
}

/** Scales a size declared in 12x8 base units to a grid of another density. */
export function scaleSize(size: GridSize, cols: number, rows: number): GridSize {
  return {
    w: Math.max(1, Math.round((size.w * cols) / BASE_COLS)),
    h: Math.max(1, Math.round((size.h * rows) / BASE_ROWS)),
  };
}

/** Converts a slot back into 12x8 base units (may be fractional). */
export function toBaseUnits(size: GridSize, cols: number, rows: number): GridSize {
  return { w: (size.w * BASE_COLS) / cols, h: (size.h * BASE_ROWS) / rows };
}

export function overlaps(a: GridItem, b: GridItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Display-proportion aspect of a slot (w/h), given the display's pixel aspect.
 * A 12x8 grid on a 3:2 display has square cells, so the default is cols/rows.
 */
export function slotAspect(
  item: GridSize,
  layout: Pick<GridLayout, "cols" | "rows">,
  displayAspect = 1.5,
) {
  const cellW = displayAspect / layout.cols;
  const cellH = 1 / layout.rows;
  return (item.w * cellW) / (item.h * cellH);
}

export function validateLayout(
  layout: GridLayout,
  constraintsFor: (instance: string) => SizeConstraints | undefined = () => undefined,
  displayAspect = 1.5,
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  if (
    !Number.isInteger(layout.cols) ||
    !Number.isInteger(layout.rows) ||
    layout.cols < 1 ||
    layout.rows < 1
  ) {
    return [{ code: "invalid", message: "Grid cols and rows must be positive integers" }];
  }
  const seen = new Set<string>();
  layout.items.forEach((item, i) => {
    const { instance } = item;
    if (seen.has(instance)) {
      issues.push({ instance, code: "duplicate", message: `"${instance}" is placed twice` });
    }
    seen.add(instance);
    if (![item.x, item.y, item.w, item.h].every(Number.isInteger) || item.w < 1 || item.h < 1) {
      issues.push({ instance, code: "invalid", message: `"${instance}" needs integer x, y, w, h` });
      return;
    }
    if (
      item.x < 0 ||
      item.y < 0 ||
      item.x + item.w > layout.cols ||
      item.y + item.h > layout.rows
    ) {
      issues.push({ instance, code: "bounds", message: `"${instance}" extends outside the grid` });
    }
    for (const other of layout.items.slice(0, i)) {
      if (other.instance !== instance && overlaps(item, other)) {
        issues.push({
          instance,
          code: "overlap",
          message: `"${instance}" overlaps "${other.instance}"`,
        });
      }
    }
    const c = constraintsFor(instance);
    if (!c) return;
    const min = scaleSize(c.min, layout.cols, layout.rows);
    const max = scaleSize(c.max, layout.cols, layout.rows);
    if (item.w < min.w || item.h < min.h) {
      issues.push({
        instance,
        code: "too-small",
        message: `"${instance}" is smaller than ${min.w}x${min.h}`,
      });
    }
    if (item.w > max.w || item.h > max.h) {
      issues.push({
        instance,
        code: "too-large",
        message: `"${instance}" is larger than ${max.w}x${max.h}`,
      });
    }
    if (c.aspect) {
      const a = slotAspect(item, layout, displayAspect);
      if (
        (c.aspect.min !== undefined && a < c.aspect.min) ||
        (c.aspect.max !== undefined && a > c.aspect.max)
      ) {
        issues.push({
          instance,
          code: "aspect",
          message: `"${instance}" aspect ${a.toFixed(2)} is out of range`,
        });
      }
    }
  });
  return issues;
}

/** First free top-left position (row-major) where a w x h item fits, or null. */
export function findFreeSpot(layout: GridLayout, size: GridSize): { x: number; y: number } | null {
  for (let y = 0; y + size.h <= layout.rows; y++) {
    for (let x = 0; x + size.w <= layout.cols; x++) {
      const probe = { instance: "", x, y, ...size };
      if (!layout.items.some((it) => overlaps(probe, it))) return { x, y };
    }
  }
  return null;
}

/** Places an instance at its default size in the first free spot. No compaction of other items. */
export function addItem(
  layout: GridLayout,
  instance: string,
  constraints: SizeConstraints,
): GridLayout {
  const size = scaleSize(constraints.default, layout.cols, layout.rows);
  const spot = findFreeSpot(layout, size);
  if (!spot) throw new Error(`No free space for ${size.w}x${size.h} on this screen`);
  return { ...layout, items: [...layout.items, { instance, ...spot, ...size }] };
}
