import { describe, expect, it } from "vitest";

import {
  UnknownHolidayYearError,
  isHoliday,
  isWeekend,
  isWorkday,
  loadedHolidayYears,
  WORKDAY_HOURS,
} from "@/lib/calendar/workdays";

describe("workdays", () => {
  it("uses the 09:00–17:00 workday confirmed by the client (Q-F)", () => {
    expect(WORKDAY_HOURS).toBe(8);
  });

  it("treats Saturday and Sunday as non-working", () => {
    expect(isWeekend("2026-08-08")).toBe(true); // sábado
    expect(isWeekend("2026-08-09")).toBe(true); // domingo
    expect(isWeekend("2026-08-07")).toBe(false); // viernes
  });

  it("recognises a fixed holiday", () => {
    expect(isHoliday("2026-05-01")).toBe(true); // Día del Trabajador
    expect(isWorkday("2026-05-01")).toBe(false);
  });

  it("uses the observed date of a moved holiday, not the nominal one", () => {
    // Güemes: nominal 17/06/2026 (miércoles) → lunes anterior, 15/06.
    expect(isHoliday("2026-06-15")).toBe(true);
    expect(isHoliday("2026-06-17")).toBe(false);
    expect(isWorkday("2026-06-17")).toBe(true);

    // Soberanía Nacional: nominal 20/11/2026 (viernes) → lunes siguiente, 23/11.
    expect(isHoliday("2026-11-23")).toBe(true);
    expect(isHoliday("2026-11-20")).toBe(false);
  });

  it("keeps a holiday that already falls on a Monday in place", () => {
    expect(isHoliday("2026-08-17")).toBe(true); // San Martín, lunes
  });

  it("counts a plain weekday as working", () => {
    expect(isWorkday("2026-08-05")).toBe(true);
  });

  // R-7: holidays are set by decree, so an unloaded year cannot be guessed.
  // Failing loudly beats silently counting 25 December as available capacity.
  it("throws for a year with no holiday data instead of assuming", () => {
    expect(() => isWorkday("2030-01-02")).toThrow(UnknownHolidayYearError);
    expect(() => isWorkday("2030-01-02")).toThrow(/No hay feriados cargados para 2030/);
  });

  it("has the current and next year loaded", () => {
    expect(loadedHolidayYears()).toEqual(expect.arrayContaining([2026, 2027]));
  });
});
