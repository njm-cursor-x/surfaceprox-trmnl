import { DEFAULT_SIZES, type SizeConstraints } from "@slate/sdk";
import { describe, expect, it } from "vitest";
import {
  addItem,
  findFreeSpot,
  idealTemplate,
  pickTemplate,
  scaleSize,
  validateLayout,
  type GridLayout,
} from "../src/index.ts";

const grid = (items: GridLayout["items"], cols = 12, rows = 8): GridLayout => ({
  cols,
  rows,
  items,
});

describe("validateLayout", () => {
  it("accepts a valid non-overlapping layout", () => {
    expect(
      validateLayout(
        grid([
          { instance: "a", x: 0, y: 0, w: 6, h: 8 },
          { instance: "b", x: 6, y: 0, w: 6, h: 8 },
        ]),
      ),
    ).toEqual([]);
  });

  it("flags bounds, overlap, duplicates, and non-integers", () => {
    const codes = validateLayout(
      grid([
        { instance: "a", x: 0, y: 0, w: 6, h: 4 },
        { instance: "b", x: 5, y: 3, w: 3, h: 3 },
        { instance: "c", x: 10, y: 0, w: 4, h: 2 },
        { instance: "a", x: 0, y: 6, w: 1, h: 1 },
        { instance: "d", x: 0.5, y: 6, w: 1, h: 1 },
      ]),
    ).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["overlap", "bounds", "duplicate", "invalid"]));
  });

  it("enforces widget min/max scaled to grid density", () => {
    const c: SizeConstraints = {
      min: { w: 4, h: 4 },
      max: { w: 8, h: 8 },
      default: { w: 4, h: 4 },
    };
    const coarse = grid([{ instance: "a", x: 0, y: 0, w: 1, h: 1 }], 6, 4);
    expect(validateLayout(coarse, () => c).map((i) => i.code)).toEqual(["too-small"]);
    const fine = grid([{ instance: "a", x: 0, y: 0, w: 8, h: 8 }], 24, 16);
    expect(validateLayout(fine, () => c)).toEqual([]);
    expect(
      validateLayout(grid([{ instance: "a", x: 0, y: 0, w: 12, h: 8 }]), () => c).map(
        (i) => i.code,
      ),
    ).toEqual(["too-large"]);
  });

  it("enforces aspect limits in display proportions", () => {
    const c: SizeConstraints = {
      ...DEFAULT_SIZES,
      min: { w: 1, h: 1 },
      aspect: { min: 0.5, max: 2 },
    };
    expect(
      validateLayout(grid([{ instance: "a", x: 0, y: 0, w: 12, h: 2 }]), () => c).map(
        (i) => i.code,
      ),
    ).toEqual(["aspect"]);
    expect(validateLayout(grid([{ instance: "a", x: 0, y: 0, w: 4, h: 4 }]), () => c)).toEqual([]);
  });
});

describe("placement", () => {
  it("scales sizes between densities", () => {
    expect(scaleSize({ w: 4, h: 3 }, 24, 16)).toEqual({ w: 8, h: 6 });
    expect(scaleSize({ w: 1, h: 1 }, 6, 4)).toEqual({ w: 1, h: 1 });
  });

  it("finds the first free spot without moving existing items", () => {
    const g = grid([{ instance: "a", x: 0, y: 0, w: 6, h: 8 }]);
    expect(findFreeSpot(g, { w: 6, h: 4 })).toEqual({ x: 6, y: 0 });
    expect(findFreeSpot(g, { w: 7, h: 1 })).toBeNull();
    const next = addItem(g, "b", { ...DEFAULT_SIZES, default: { w: 4, h: 3 } });
    expect(next.items).toEqual([g.items[0], { instance: "b", x: 6, y: 0, w: 4, h: 3 }]);
    expect(() =>
      addItem(grid([{ instance: "a", x: 0, y: 0, w: 12, h: 8 }]), "b", DEFAULT_SIZES),
    ).toThrow(/No free space/);
  });
});

describe("template mapping", () => {
  const g = { cols: 12, rows: 8 };
  it.each([
    [{ w: 12, h: 8 }, "full"],
    [{ w: 9, h: 6 }, "full"],
    [{ w: 12, h: 4 }, "half_horizontal"],
    [{ w: 8, h: 3 }, "half_horizontal"],
    [{ w: 6, h: 8 }, "half_vertical"],
    [{ w: 4, h: 6 }, "half_vertical"],
    [{ w: 6, h: 4 }, "quadrant"],
    [{ w: 3, h: 2 }, "quadrant"],
    [{ w: 4, h: 1 }, "quadrant"],
  ] as const)("%o -> %s", (slot, layout) => expect(idealTemplate(slot, g)).toBe(layout));

  it("falls back to what the widget ships", () => {
    expect(pickTemplate({ w: 12, h: 4 }, g, ["full", "quadrant"])).toBe("full");
    expect(pickTemplate({ w: 3, h: 2 }, g, ["full"])).toBe("full");
  });

  it("applies plugin rules in 12x8 units, including on other densities", () => {
    const rules = { "w<=3": "quadrant", "w>=10, h<=3": "half_horizontal" } as const;
    expect(pickTemplate({ w: 3, h: 8 }, g, ["full", "quadrant", "half_horizontal"], rules)).toBe(
      "quadrant",
    );
    expect(pickTemplate({ w: 6, h: 16 }, { cols: 24, rows: 16 }, ["full", "quadrant"], rules)).toBe(
      "quadrant",
    );
    expect(pickTemplate({ w: 12, h: 3 }, g, ["full", "half_horizontal"], rules)).toBe(
      "half_horizontal",
    );
    expect(() => pickTemplate({ w: 1, h: 1 }, g, ["full"], { "x<1": "full" })).toThrow(
      /Invalid template rule/,
    );
  });
});
