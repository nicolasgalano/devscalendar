import { describe, expect, it } from "vitest";

import { aggregateDayLoad, formatHours, loadClasses } from "@/lib/calendar/load";

const AR = "America/Argentina/Buenos_Aires";

/**
 * Local wall clock in Buenos Aires as a UTC instant. Built by adding hours to
 * local midnight rather than formatting a string, so hour 24 lands on the next
 * midnight instead of producing an invalid `T27:00:00Z`.
 */
const on = (day: string, hour: number) =>
  new Date(Date.parse(`2026-08-${day}T03:00:00Z`) + hour * 3_600_000).toISOString();

const base = { tz: AR, devCount: 3 }; // capacidad = 3 × 8 h = 24 h

describe("aggregateDayLoad", () => {
  it("reports an empty working day as unoccupied", () => {
    const [day] = aggregateDayLoad({ ...base, spans: [], days: ["2026-08-05"] });
    expect(day).toMatchObject({ bookings: 0, minutes: 0, occupancy: 0, level: "none" });
  });

  it("scales occupancy against the whole team's capacity", () => {
    const [day] = aggregateDayLoad({
      ...base,
      days: ["2026-08-05"],
      spans: [{ id: "a", startsAt: on("05", 9), endsAt: on("05", 13) }], // 4 h
    });
    expect(day!.minutes).toBe(240);
    expect(day!.occupancy).toBeCloseTo(240 / 1440);
    expect(day!.level).toBe("low");
  });

  it("walks the ramp from low to over", () => {
    const level = (hours: number) =>
      aggregateDayLoad({
        ...base,
        days: ["2026-08-05"],
        spans: [{ id: "a", startsAt: on("05", 0), endsAt: on("05", hours) }],
      })[0]!.level;

    expect(level(4)).toBe("low"); // 16 %
    expect(level(12)).toBe("medium"); // 50 %
    expect(level(20)).toBe("high"); // 83 %
    expect(level(24)).toBe("full"); // 100 %
  });

  it("flags over-assignment beyond capacity", () => {
    const [day] = aggregateDayLoad({
      ...base,
      devCount: 1, // capacidad 8 h
      days: ["2026-08-05"],
      spans: [{ id: "a", startsAt: on("05", 9), endsAt: on("05", 19) }], // 10 h
    });
    expect(day!.level).toBe("over");
  });

  it("counts only the selected developer's capacity when filtering by one", () => {
    const spans = [{ id: "a", startsAt: on("05", 9), endsAt: on("05", 17) }]; // 8 h
    const team = aggregateDayLoad({ ...base, days: ["2026-08-05"], spans });
    const single = aggregateDayLoad({ ...base, devCount: 1, days: ["2026-08-05"], spans });

    // La misma jornada reservada: un tercio de la capacidad del equipo, pero
    // el día completo del desarrollador filtrado.
    expect(team[0]!.occupancy).toBeCloseTo(1 / 3);
    expect(team[0]!.level).toBe("low");
    expect(single[0]!.occupancy).toBe(1);
    expect(single[0]!.level).toBe("full");
  });

  // Q-F / Q-G: booking a Saturday is exceptional but allowed. Capacity is zero,
  // so any booked minute is over capacity — and that is the signal we want.
  it("marks a non-working day with bookings as over capacity", () => {
    const [saturday] = aggregateDayLoad({
      ...base,
      days: ["2026-08-08"],
      spans: [{ id: "a", startsAt: on("08", 10), endsAt: on("08", 14) }],
    });
    expect(saturday).toMatchObject({ isWorkday: false, occupancy: null, level: "over" });
    expect(saturday!.minutes).toBe(240);
  });

  it("leaves an empty non-working day neutral", () => {
    const [saturday] = aggregateDayLoad({ ...base, spans: [], days: ["2026-08-08"] });
    expect(saturday).toMatchObject({ isWorkday: false, occupancy: null, level: "none" });
    expect(loadClasses(saturday!)).toBe("bg-muted");
  });

  it("treats a public holiday as a non-working day", () => {
    const [holiday] = aggregateDayLoad({ ...base, spans: [], days: ["2026-05-01"] });
    expect(holiday!.isWorkday).toBe(false);
  });

  it("splits a booking that crosses midnight across both days", () => {
    const days = aggregateDayLoad({
      ...base,
      days: ["2026-08-05", "2026-08-06"],
      // 22:00 del 5 → 02:00 del 6, hora local.
      spans: [{ id: "a", startsAt: "2026-08-06T01:00:00Z", endsAt: "2026-08-06T05:00:00Z" }],
    });

    expect(days[0]).toMatchObject({ minutes: 120, bookings: 1 });
    expect(days[1]).toMatchObject({ minutes: 120, bookings: 1 });
  });

  it("never divides by zero when no developers are loaded", () => {
    const [day] = aggregateDayLoad({
      ...base,
      devCount: 0,
      days: ["2026-08-05"],
      spans: [{ id: "a", startsAt: on("05", 9), endsAt: on("05", 13) }],
    });
    expect(day!.occupancy).toBeNull();
    expect(Number.isFinite(day!.minutes)).toBe(true);
  });
});

describe("formatHours", () => {
  it("keeps whole hours clean and shows one decimal otherwise", () => {
    expect(formatHours(240)).toBe("4 h");
    expect(formatHours(150)).toBe("2.5 h");
  });
});
