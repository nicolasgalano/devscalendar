import { describe, expect, it } from "vitest";

import { assignColumns, groupIntoLanes, rowCount, toGridRows } from "@/lib/calendar/layout";
import { DEFAULT_DAY_WINDOW } from "@/lib/calendar/range";

const at = (hour: number, minute = 0) =>
  `2026-08-05T${String(hour + 3).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;

describe("toGridRows", () => {
  it("maps a four-hour booking onto eight half-hour rows", () => {
    expect(toGridRows({ startMinute: 9 * 60, endMinute: 13 * 60 }, DEFAULT_DAY_WINDOW)).toEqual({
      rowStart: 1,
      rowEnd: 9,
    });
  });

  it("starts later in the grid for a booking that starts later", () => {
    expect(toGridRows({ startMinute: 14 * 60, endMinute: 17 * 60 }, DEFAULT_DAY_WINDOW)).toEqual({
      rowStart: 11,
      rowEnd: 17,
    });
  });

  // A block with zero height would be invisible and impossible to click.
  it("gives a sub-slot booking a full row", () => {
    expect(toGridRows({ startMinute: 9 * 60, endMinute: 9 * 60 + 15 }, DEFAULT_DAY_WINDOW)).toEqual({
      rowStart: 1,
      rowEnd: 2,
    });
  });

  it("counts the rows of the default window", () => {
    expect(rowCount(DEFAULT_DAY_WINDOW)).toBe(16); // 8 h en franjas de 30 min
  });
});

describe("assignColumns", () => {
  it("leaves a lone booking full width", () => {
    const [only] = assignColumns([{ startsAt: at(9), endsAt: at(13) }]);
    expect(only).toMatchObject({ column: 0, columns: 1 });
  });

  it("splits two overlapping bookings into two columns", () => {
    const laid = assignColumns([
      { id: "a", startsAt: at(9), endsAt: at(13) },
      { id: "b", startsAt: at(10), endsAt: at(12) },
    ]);
    expect(laid.map((entry) => entry.columns)).toEqual([2, 2]);
    expect(laid.map((entry) => entry.column).sort()).toEqual([0, 1]);
  });

  /**
   * The case a per-pair algorithm gets wrong: A and C never touch each other,
   * but both touch B. Counting overlaps per booking would give widths 2, 3, 2 —
   * three different grids inside one visual group.
   */
  it("gives a chain of overlaps a single shared width", () => {
    const laid = assignColumns([
      { id: "a", startsAt: at(9), endsAt: at(10) },
      { id: "b", startsAt: at(9, 30), endsAt: at(10, 30) },
      { id: "c", startsAt: at(10), endsAt: at(11) },
    ]);

    expect(laid.every((entry) => entry.columns === 2)).toBe(true);
    const byId = Object.fromEntries(laid.map((entry) => [entry.item.id, entry.column]));
    // C reuses A's column: A already ended when C starts.
    expect(byId).toEqual({ a: 0, b: 1, c: 0 });
  });

  it("keeps disjoint clusters independent", () => {
    const laid = assignColumns([
      { id: "a", startsAt: at(9), endsAt: at(10) },
      { id: "b", startsAt: at(9, 30), endsAt: at(10, 30) },
      { id: "c", startsAt: at(14), endsAt: at(15) },
    ]);
    const byId = Object.fromEntries(laid.map((entry) => [entry.item.id, entry.columns]));
    expect(byId).toEqual({ a: 2, b: 2, c: 1 });
  });

  it("does not treat touching bookings as overlapping", () => {
    const laid = assignColumns([
      { id: "a", startsAt: at(9), endsAt: at(10) },
      { id: "b", startsAt: at(10), endsAt: at(11) },
    ]);
    expect(laid.every((entry) => entry.columns === 1)).toBe(true);
  });
});

describe("groupIntoLanes", () => {
  it("groups by key and sorts lanes by name", () => {
    const lanes = groupIntoLanes(
      [
        { id: "1", dev: { id: "d2", name: "Rodrigo Paz" } },
        { id: "2", dev: { id: "d1", name: "Cristian Soto" } },
        { id: "3", dev: { id: "d2", name: "Rodrigo Paz" } },
      ],
      (item) => item.dev,
    );

    expect(lanes.map((lane) => lane.name)).toEqual(["Cristian Soto", "Rodrigo Paz"]);
    expect(lanes[1]!.items).toHaveLength(2);
  });
});
