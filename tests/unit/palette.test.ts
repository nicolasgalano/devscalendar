import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { CATEGORY_COUNT, categoryClasses, categoryIndex } from "@/lib/calendar/palette";

describe("categoryIndex", () => {
  it("is stable for the same id", () => {
    const id = "00000000-0000-4000-8000-000000000041";
    expect(categoryIndex(id)).toBe(categoryIndex(id));
  });

  it("stays inside the palette", () => {
    for (let index = 0; index < 500; index += 1) {
      const value = categoryIndex(randomUUID());
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(CATEGORY_COUNT);
    }
  });

  /**
   * uuids share long common prefixes, so a weak hash clumps them into a couple
   * of hues and the grid ends up looking monochrome.
   */
  it("spreads uuids across all eight hues", () => {
    const buckets = new Set<number>();
    for (let index = 0; index < 400; index += 1) buckets.add(categoryIndex(randomUUID()));
    expect(buckets.size).toBe(CATEGORY_COUNT);
  });

  it("distributes roughly evenly", () => {
    const counts = new Map<number, number>();
    const total = 4_000;
    for (let index = 0; index < total; index += 1) {
      const bucket = categoryIndex(randomUUID());
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    const expected = total / CATEGORY_COUNT;
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected * 0.6);
      expect(count).toBeLessThan(expected * 1.4);
    }
  });
});

describe("categoryClasses", () => {
  // Tailwind only emits CSS for class names it can find literally in the source.
  it("returns literal class names, never interpolated ones", () => {
    const classes = categoryClasses("00000000-0000-4000-8000-000000000041");
    expect(classes).toMatch(/^bg-cat-[1-8]-surface border-l-cat-[1-8]-line$/);
  });
});
