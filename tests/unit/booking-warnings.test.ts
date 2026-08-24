import { describe, expect, it } from "vitest";

import { describeBookingWarnings } from "@/lib/bookings/warnings";
import { canCreateBookings, canManageProject } from "@/lib/bookings/permissions";

const workday = { date: "2026-08-12", startTime: "09:00", endTime: "17:00" };
const ids = (values: { date: string; startTime: string; endTime: string }) =>
  describeBookingWarnings(values).map((warning) => warning.id);

describe("describeBookingWarnings", () => {
  it("says nothing about a booking inside the workday", () => {
    expect(describeBookingWarnings(workday)).toEqual([]);
  });

  it("warns on a weekend, naming the day", () => {
    const [warning] = describeBookingWarnings({ ...workday, date: "2026-08-15" });

    expect(warning?.id).toBe("non-workday");
    expect(warning?.message).toBe("Sábado: día no laborable.");
  });

  it("warns on an Argentine public holiday", () => {
    // 17/08/2026, San Martín: cae lunes, no se traslada.
    const [warning] = describeBookingWarnings({ ...workday, date: "2026-08-17" });

    expect(warning?.id).toBe("non-workday");
    expect(warning?.message).toBe("Feriado: día no laborable.");
  });

  it("warns outside 09:00–17:00 on either end", () => {
    expect(ids({ ...workday, startTime: "08:00" })).toEqual(["outside-hours"]);
    expect(ids({ ...workday, endTime: "20:00" })).toEqual(["outside-hours"]);
  });

  it("treats the workday bounds themselves as inside", () => {
    expect(ids({ ...workday, startTime: "09:00", endTime: "17:00" })).toEqual([]);
  });

  it("reports both reasons at once", () => {
    expect(ids({ date: "2026-08-15", startTime: "22:00", endTime: "23:00" })).toEqual([
      "non-workday",
      "outside-hours",
    ]);
  });

  /**
   * La tabla de feriados se carga a mano y no se puede calcular (R-7 de 003).
   * Para un año sin datos el diálogo lo dice, en vez de romperse o de sugerir
   * que la fecha se verificó cuando no se pudo.
   */
  it("says so when the year has no holidays loaded, instead of throwing", () => {
    const warnings = describeBookingWarnings({ ...workday, date: "2028-03-15" });

    expect(warnings.map((warning) => warning.id)).toEqual(["unknown-holidays"]);
    expect(warnings[0]!.message).toContain("2026");
  });

  it("never blocks: it only ever returns text", () => {
    // AC-1.4 en una línea — no hay forma de que esta función rechace nada.
    expect(
      describeBookingWarnings({ date: "2026-08-15", startTime: "03:00", endTime: "04:00" }),
    ).toHaveLength(2);
  });
});

describe("canManageProject", () => {
  const project = { pmId: "pm-1" };

  it("lets an admin manage any project", () => {
    expect(canManageProject({ id: "admin-1", role: "admin" }, project)).toBe(true);
  });

  it("lets a PM manage only their own", () => {
    expect(canManageProject({ id: "pm-1", role: "pm" }, project)).toBe(true);
    expect(canManageProject({ id: "pm-2", role: "pm" }, project)).toBe(false);
  });

  it("keeps developers and role-less users out", () => {
    expect(canManageProject({ id: "pm-1", role: "developer" }, project)).toBe(false);
    expect(canManageProject({ id: "pm-1", role: null }, project)).toBe(false);
    expect(canManageProject(null, project)).toBe(false);
  });
});

describe("canCreateBookings", () => {
  it("is the admin and the PM, nobody else", () => {
    expect(canCreateBookings({ id: "a", role: "admin" })).toBe(true);
    expect(canCreateBookings({ id: "b", role: "pm" })).toBe(true);
    expect(canCreateBookings({ id: "c", role: "developer" })).toBe(false);
    expect(canCreateBookings(null)).toBe(false);
  });
});
