import { describe, expect, it } from "vitest";

import { PLANNING_VISIBLE_DAYS } from "@/lib/planning/constants";
import {
  getCapacityWeekBounds,
  getCapacityWeekBoundsFromStart,
} from "@/lib/planning/range";

/**
 * Feature 029 — T2.9. Hoy ancla en la PRIMERA fila (capacity planning es
 * forward-looking, a diferencia del planning del calendar que mira
 * contexto histórico). El cómputo no depende del `new Date()` local, por
 * eso recibe `today` como parámetro — test determinista.
 */
describe("getCapacityWeekBounds", () => {
  // 2026-10-21 es un miércoles. Monday-of-week es 2026-10-19.
  const today = "2026-10-21";

  it("returns 28 days", () => {
    const { days } = getCapacityWeekBounds(today);
    expect(days).toHaveLength(PLANNING_VISIBLE_DAYS);
  });

  it("anchors today in the first row (weekStart = mondayOf(today))", () => {
    const { weekStart, days } = getCapacityWeekBounds(today);
    expect(weekStart).toBe("2026-10-19");
    // El lunes de hoy es el día 0 de la grilla.
    expect(days[0]).toBe("2026-10-19");
    // La propia fecha "hoy" (miércoles) cae dos días después.
    expect(days[2]).toBe("2026-10-21");
    // La cuarta fila (días 21-27) cae tres semanas adelante.
    expect(days[21]).toBe("2026-11-09");
  });

  it("offsetWeeks=1 advances one week", () => {
    const base = getCapacityWeekBounds(today);
    const next = getCapacityWeekBounds(today, 1);
    expect(next.weekStart > base.weekStart).toBe(true);
    // Diferencia exacta de 7 días.
    const diff = daysBetween(base.weekStart, next.weekStart);
    expect(diff).toBe(7);
  });

  it("offsetWeeks=-1 goes back one week", () => {
    const base = getCapacityWeekBounds(today);
    const prev = getCapacityWeekBounds(today, -1);
    expect(prev.weekStart < base.weekStart).toBe(true);
    expect(daysBetween(prev.weekStart, base.weekStart)).toBe(7);
  });

  it("days are consecutive and ISO formatted", () => {
    const { days } = getCapacityWeekBounds(today);
    for (let i = 1; i < days.length; i++) {
      const prev = days[i - 1]!;
      const curr = days[i]!;
      expect(daysBetween(prev, curr)).toBe(1);
      expect(curr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("getCapacityWeekBoundsFromStart", () => {
  it("normalizes to the Monday of the given date", () => {
    // 2026-10-21 es miércoles; su lunes es 2026-10-19.
    const { weekStart } = getCapacityWeekBoundsFromStart("2026-10-21");
    expect(weekStart).toBe("2026-10-19");
  });

  it("preserves a Monday", () => {
    const { weekStart } = getCapacityWeekBoundsFromStart("2026-10-19");
    expect(weekStart).toBe("2026-10-19");
  });

  it("returns 28 days from the normalized Monday", () => {
    const { days } = getCapacityWeekBoundsFromStart("2026-10-21");
    expect(days[0]).toBe("2026-10-19");
    expect(days).toHaveLength(PLANNING_VISIBLE_DAYS);
  });
});

function daysBetween(from: string, to: string): number {
  const diff =
    new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(diff / 86_400_000);
}
