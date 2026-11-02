import { describe, expect, it } from "vitest";

import { getLocalDayISO } from "@/lib/time-entries/week";

describe("getLocalDayISO (America/Argentina/Buenos_Aires)", () => {
  it("maps a UTC afternoon to the same calendar day in BA", () => {
    // 2026-11-02 15:00 UTC → BA (UTC-3) → 2026-11-02 12:00 → día 2026-11-02.
    expect(getLocalDayISO("2026-11-02T15:00:00Z")).toBe("2026-11-02");
  });

  it("maps a UTC very-early-morning to the previous day in BA", () => {
    // 2026-11-02 02:30 UTC → BA (UTC-3) → 2026-11-01 23:30 → día 2026-11-01.
    expect(getLocalDayISO("2026-11-02T02:30:00Z")).toBe("2026-11-01");
  });

  it("maps a UTC late evening to the next day in BA only when it crosses", () => {
    // BA está -3, así que no cruza al día siguiente nunca por la tarde — el
    // caso de cruce al día siguiente es solo si el UTC es un día posterior.
    // 2026-11-02 23:30 UTC → BA 2026-11-02 20:30 → mismo día.
    expect(getLocalDayISO("2026-11-02T23:30:00Z")).toBe("2026-11-02");
  });

  it("maps midnight UTC Monday to Sunday in BA", () => {
    // 2026-11-02 (lun) 00:00 UTC → BA (UTC-3) → 2026-11-01 (dom) 21:00.
    expect(getLocalDayISO("2026-11-02T00:00:00Z")).toBe("2026-11-01");
  });

  it("returns empty string for a garbled input (defensive)", () => {
    expect(getLocalDayISO("not-a-date")).toBe("");
  });
});
