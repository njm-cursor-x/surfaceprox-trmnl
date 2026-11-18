import { describe, expect, it } from "vitest";
import {
  activeItems,
  currentItem,
  inWindow,
  localTime,
  nightState,
  parseClock,
  type Playlist,
} from "../src/index.ts";

describe("time helpers", () => {
  it("parses HH:MM and handles windows that wrap midnight", () => {
    expect(parseClock("07:30")).toBe(450);
    expect(() => parseClock("25:00")).toThrow();
    expect(inWindow(parseClock("23:00"), "22:00", "07:00")).toBe(true);
    expect(inWindow(parseClock("06:59"), "22:00", "07:00")).toBe(true);
    expect(inWindow(parseClock("07:00"), "22:00", "07:00")).toBe(false);
    expect(inWindow(parseClock("12:00"), "09:00", "17:00")).toBe(true);
  });

  it("computes local time in a given zone", () => {
    const t = localTime(new Date("2026-11-18T23:30:00Z"), "America/New_York");
    expect(t).toEqual({ weekday: "wed", minutes: 18 * 60 + 30 });
    expect(localTime(new Date("2026-11-18T23:30:00Z"), "Asia/Tokyo").weekday).toBe("thu");
  });
});

describe("playlists", () => {
  const playlist: Playlist = {
    items: [
      { screen: "a", dwell: "10s" },
      { screen: "b", dwell: "20s" },
      { screen: "evening", dwell: "1m", when: { from: "18:00", to: "23:00" } },
      { screen: "weekend", dwell: "1m", when: { days: ["sat", "sun"] } },
    ],
  };
  const at = (iso: string) => new Date(iso);

  it("filters items by schedule rules", () => {
    expect(activeItems(playlist, at("2026-11-18T12:00:00Z"), "UTC").map((i) => i.screen)).toEqual([
      "a",
      "b",
    ]);
    expect(activeItems(playlist, at("2026-11-21T19:00:00Z"), "UTC").map((i) => i.screen)).toEqual([
      "a",
      "b",
      "evening",
      "weekend",
    ]);
  });

  it("rotates deterministically by dwell from the epoch", () => {
    const epoch = at("2026-11-18T12:00:00Z");
    const pos = (s: number) =>
      currentItem(playlist, new Date(epoch.getTime() + s * 1000), epoch, "UTC");
    expect(pos(0)).toMatchObject({ index: 0, remainingMs: 10_000 });
    expect(pos(9)!.item.screen).toBe("a");
    expect(pos(10)).toMatchObject({ index: 1, remainingMs: 20_000 });
    expect(pos(29)!.item.screen).toBe("b");
    expect(pos(30)!.item.screen).toBe("a");
  });

  it("returns null when nothing is scheduled", () => {
    expect(
      currentItem(
        { items: [{ screen: "x", dwell: "1m", when: { days: ["mon"] } }] },
        at("2026-11-18T12:00:00Z"),
        undefined,
        "UTC",
      ),
    ).toBeNull();
  });
});

describe("night mode", () => {
  const night = { enabled: true, from: "22:00", to: "07:00", dim: 0.6, theme: "ink-dark" };

  it("dims and switches theme inside the window", () => {
    expect(nightState(night, "paper", new Date("2026-11-18T23:00:00Z"), "UTC")).toEqual({
      active: true,
      dim: 0.6,
      theme: "ink-dark",
    });
    expect(nightState(night, "paper", new Date("2026-11-18T12:00:00Z"), "UTC")).toEqual({
      active: false,
      dim: 0,
      theme: "paper",
    });
  });

  it("supports dim-only, dark-only, and disabled", () => {
    const t = new Date("2026-11-18T02:00:00Z");
    expect(nightState({ ...night, theme: null }, "paper", t, "UTC")).toEqual({
      active: true,
      dim: 0.6,
      theme: "paper",
    });
    expect(nightState({ ...night, dim: 0 }, "paper", t, "UTC")).toEqual({
      active: true,
      dim: 0,
      theme: "ink-dark",
    });
    expect(nightState({ ...night, enabled: false }, "paper", t, "UTC").active).toBe(false);
  });

  it("caps dim so the screen never goes fully black", () => {
    expect(
      nightState({ ...night, dim: 5 }, "paper", new Date("2026-11-18T23:00:00Z"), "UTC").dim,
    ).toBe(0.95);
  });
});
