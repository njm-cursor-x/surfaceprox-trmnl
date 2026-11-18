import { describe, expect, it } from "vitest";
import { extractTemplates, filters, renderTrmnl } from "../src/index.ts";

describe("TRMNL filters", () => {
  it("formats numbers and currency", () => {
    expect(filters.numberWithDelimiter(1234567.891)).toBe("1,234,567.891");
    expect(filters.numberWithDelimiter("9876", ".")).toBe("9.876");
    expect(filters.numberToCurrency(1234.5)).toBe("$1,234.50");
    expect(filters.numberToCurrency(-12, "€")).toBe("-€12.00");
  });

  it("pluralizes and ordinalizes", () => {
    expect(filters.pluralize(1, "book")).toBe("1 book");
    expect(filters.pluralize(3, "person", "people")).toBe("3 people");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 112].map(filters.ordinalize)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "112th",
    ]);
  });

  it("handles dates and relative times", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    expect(filters.daysAgo(3, now)).toBe("2026-11-15");
    expect(filters.timeAgo(now.getTime() - 30_000, now)).toBe("just now");
    expect(filters.timeAgo(now.getTime() - 12 * 60_000, now)).toBe("12m ago");
    expect(filters.timeAgo("2026-11-18T09:00:00Z", now)).toBe("3h ago");
    expect(filters.timeAgo(undefined, now)).toBe("");
  });

  it("groups, finds, parses JSON, and labels WMO codes", () => {
    const list = [
      { k: "a", n: 1 },
      { k: "b", n: 2 },
      { k: "a", n: 3 },
    ];
    expect(filters.groupBy(list, "k")).toEqual({ a: [list[0], list[2]], b: [list[1]] });
    expect(filters.findBy(list, "n", 2)).toBe(list[1]);
    expect(filters.findBy(list, "n", 9, "none")).toBe("none");
    expect(filters.parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(filters.parseJson("nope")).toBeNull();
    expect(filters.wmoLabel(61)).toBe("Light rain");
    expect(filters.wmoLabel(1234)).toBe("Unknown");
  });
});

describe("renderTrmnl", () => {
  it("renders with TRMNL filters registered", async () => {
    const html = await renderTrmnl(
      "{{ n | number_with_delimiter }} {{ 2 | pluralize: 'cat' }} {{ c | wmo_label }}",
      { n: 12345, c: 3 },
    );
    expect(html).toBe("12,345 2 cats Overcast");
  });

  it("supports {% template %} blocks from shared.liquid via {% render %}", async () => {
    const shared = `{% template title_bar %}<div class="title_bar">{{ t }}</div>{% endtemplate %}`;
    const html = await renderTrmnl(
      `<main></main>{% render "title_bar", t: name %}`,
      { name: "Hi" },
      { shared },
    );
    expect(html.trim()).toBe('<main></main><div class="title_bar">Hi</div>');
  });

  it("resolves dynamic partials (extension templates)", async () => {
    const html = await renderTrmnl(
      `{% assign p = "clock.face/" | append: face %}{% include p %}`,
      { face: "word", who: "world" },
      { partials: { "clock.face/word": "IT IS {{ who }}" } },
    );
    expect(html).toBe("IT IS world");
  });

  it("escapes nothing implicitly but cannot run code", async () => {
    await expect(renderTrmnl("{{ constructor.constructor }}", {})).resolves.toBe("");
  });

  it("extracts template blocks", () => {
    expect(extractTemplates("a{% template x %}X{% endtemplate %}b")).toEqual({
      body: "ab",
      partials: { x: "X" },
    });
  });
});
