import { describe, expect, it } from "vitest";

import { sumByDay, sumByDevWeek, type Estimate } from "@/lib/planning/totals";

/**
 * Feature 029 — T2.9. Las sumas viven en cliente para no bajar más queries;
 * el valor del test está en los casos borde que la UI del footer vs el
 * margen hace confundibles (buckets por semana contados desde days[0], no
 * desde el día del mes).
 */
describe("sumByDay", () => {
  it("returns an empty map for no estimates", () => {
    expect(sumByDay([]).size).toBe(0);
  });

  it("counts a single estimate", () => {
    const totals = sumByDay([{ devId: "d1", date: "2026-10-21", hours: 4 }]);
    expect(totals.get("2026-10-21")).toBe(4);
  });

  it("sums multiple estimates on the same day across devs", () => {
    const totals = sumByDay([
      { devId: "d1", date: "2026-10-21", hours: 4 },
      { devId: "d2", date: "2026-10-21", hours: 2 },
      { devId: "d3", date: "2026-10-21", hours: 1.5 },
    ]);
    expect(totals.get("2026-10-21")).toBe(7.5);
  });

  it("keeps days separate", () => {
    const totals = sumByDay([
      { devId: "d1", date: "2026-10-21", hours: 4 },
      { devId: "d1", date: "2026-10-22", hours: 3 },
    ]);
    expect(totals.get("2026-10-21")).toBe(4);
    expect(totals.get("2026-10-22")).toBe(3);
  });
});

describe("sumByDevWeek", () => {
  const days = buildDays("2026-10-19", 28);

  it("returns an empty map for no estimates", () => {
    expect(sumByDevWeek([], days).size).toBe(0);
  });

  it("buckets by week index counting from days[0]", () => {
    const estimates: Estimate[] = [
      { devId: "d1", date: "2026-10-19", hours: 4 }, // week 0 (lunes 1ra fila)
      { devId: "d1", date: "2026-10-25", hours: 2 }, // week 0 (domingo 1ra fila)
      { devId: "d1", date: "2026-10-26", hours: 3 }, // week 1 (lunes 2da fila)
    ];
    const result = sumByDevWeek(estimates, days);
    const d1 = result.get("d1")!;
    expect(d1.get(0)).toBe(6);
    expect(d1.get(1)).toBe(3);
  });

  it("separates devs", () => {
    const estimates: Estimate[] = [
      { devId: "d1", date: "2026-10-19", hours: 4 },
      { devId: "d2", date: "2026-10-19", hours: 2 },
    ];
    const result = sumByDevWeek(estimates, days);
    expect(result.get("d1")!.get(0)).toBe(4);
    expect(result.get("d2")!.get(0)).toBe(2);
  });

  it("ignores estimates outside the visible range", () => {
    const estimates: Estimate[] = [
      { devId: "d1", date: "2026-10-19", hours: 4 },  // visible
      { devId: "d1", date: "2025-01-01", hours: 10 }, // fuera
      { devId: "d1", date: "2027-06-01", hours: 10 }, // fuera
    ];
    const result = sumByDevWeek(estimates, days);
    const d1 = result.get("d1")!;
    expect(d1.size).toBe(1);
    expect(d1.get(0)).toBe(4);
  });
});

function buildDays(start: string, count: number): string[] {
  const result: string[] = [];
  const base = new Date(`${start}T00:00:00Z`).getTime();
  for (let i = 0; i < count; i++) {
    result.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  }
  return result;
}
