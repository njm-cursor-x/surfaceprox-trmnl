import { BASE_COLS, BASE_ROWS } from "./grid.ts";

export interface TemplateSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutTemplate {
  id: string;
  name: string;
  /** Slots in 12x8 base units, largest first so the main widget lands in slot 0. */
  slots: TemplateSlot[];
}

const W = BASE_COLS;
const H = BASE_ROWS;

/** TRMNL's fixed layouts as predefined grids (D7: free-form grid plus example templates). */
export const LAYOUT_TEMPLATES: readonly LayoutTemplate[] = [
  { id: "full", name: "Full screen", slots: [{ x: 0, y: 0, w: W, h: H }] },
  {
    id: "halves",
    name: "Two side by side",
    slots: [
      { x: 0, y: 0, w: W / 2, h: H },
      { x: W / 2, y: 0, w: W / 2, h: H },
    ],
  },
  {
    id: "halves-stacked",
    name: "Two stacked",
    slots: [
      { x: 0, y: 0, w: W, h: H / 2 },
      { x: 0, y: H / 2, w: W, h: H / 2 },
    ],
  },
  {
    id: "quadrants",
    name: "Four quadrants",
    slots: [
      { x: 0, y: 0, w: W / 2, h: H / 2 },
      { x: W / 2, y: 0, w: W / 2, h: H / 2 },
      { x: 0, y: H / 2, w: W / 2, h: H / 2 },
      { x: W / 2, y: H / 2, w: W / 2, h: H / 2 },
    ],
  },
  {
    id: "one-plus-two",
    name: "One big, two small",
    slots: [
      { x: 0, y: 0, w: (W * 2) / 3, h: H },
      { x: (W * 2) / 3, y: 0, w: W / 3, h: H / 2 },
      { x: (W * 2) / 3, y: H / 2, w: W / 3, h: H / 2 },
    ],
  },
];

export function layoutTemplate(id: string): LayoutTemplate | undefined {
  return LAYOUT_TEMPLATES.find((t) => t.id === id);
}

/** Fills a template's slots with instances, in order, on a 12x8 grid. */
export function applyTemplate(template: LayoutTemplate, instances: readonly string[]) {
  if (instances.length > template.slots.length) {
    throw new Error(`Template "${template.id}" has ${template.slots.length} slots`);
  }
  return {
    cols: W,
    rows: H,
    items: instances.map((instance, i) => ({ instance, ...template.slots[i]! })),
  };
}
