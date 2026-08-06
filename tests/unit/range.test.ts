import { describe, expect, it } from "vitest";

import {
  addMonths,
  addYears,
  DEFAULT_DAY_WINDOW,
  daysInMonth,
  instantToIsoDate,
  monthsInYear,
  resolveRange,
  shiftDate,
  visibleDayWindow,
  zonedToInstant,
} from "@/lib/calendar/range";

const AR = "America/Argentina/Buenos_Aires"; // UTC-3, sin horario de verano
const MADRID = "Europe/Madrid"; // con DST, para no atarnos a una sola TZ

describe("resolveRange", () => {
  it("covers the local day, not the UTC one", () => {
    expect(resolveRange("day", "2026-08-05", AR)).toEqual({
      from: "2026-08-05T03:00:00.000Z",
      to: "2026-08-06T03:00:00.000Z",
    });
  });

  it("covers the calendar month", () => {
    expect(resolveRange("month", "2026-08-19", AR)).toEqual({
      from: "2026-08-01T03:00:00.000Z",
      to: "2026-09-01T03:00:00.000Z",
    });
  });

  it("covers the calendar year", () => {
    expect(resolveRange("year", "2026-08-19", AR)).toEqual({
      from: "2026-01-01T03:00:00.000Z",
      to: "2027-01-01T03:00:00.000Z",
    });
  });

  it("resolves the offset of a timezone that observes DST", () => {
    // Madrid: UTC+1 en enero, UTC+2 en julio.
    expect(resolveRange("day", "2026-01-15", MADRID).from).toBe("2026-01-14T23:00:00.000Z");
    expect(resolveRange("day", "2026-07-15", MADRID).from).toBe("2026-07-14T22:00:00.000Z");
  });

  it("round-trips a date through the timezone conversion", () => {
    const instant = zonedToInstant("2026-03-01", AR);
    expect(instantToIsoDate(instant, AR)).toBe("2026-03-01");
  });
});

describe("calendar arithmetic", () => {
  it("clamps the day when the target month is shorter", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29"); // bisiesto
  });

  it("crosses year boundaries", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("clamps 29 February when the next year is not a leap year", () => {
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
  });

  it("lists every day of a month, including the leap day", () => {
    expect(daysInMonth("2026-02-10")).toHaveLength(28);
    expect(daysInMonth("2028-02-10")).toHaveLength(29);
    expect(daysInMonth("2026-08-01")[0]).toBe("2026-08-01");
  });

  it("lists the twelve month anchors of a year", () => {
    const months = monthsInYear("2026-08-19");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-01-01");
    expect(months[11]).toBe("2026-12-01");
  });
});

describe("shiftDate", () => {
  it("moves by one day, month or year depending on the view", () => {
    expect(shiftDate("day", "2026-08-05", 1)).toBe("2026-08-06");
    expect(shiftDate("day", "2026-08-05", -1)).toBe("2026-08-04");
    expect(shiftDate("year", "2026-08-05", 1)).toBe("2027-01-01");
  });

  it("snaps to the first of the month so navigation never drifts", () => {
    // Desde el 31, avanzar y retroceder tiene que volver al mismo mes.
    expect(shiftDate("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftDate("month", shiftDate("month", "2026-01-31", 1), -1)).toBe("2026-01-01");
  });
});

describe("visibleDayWindow", () => {
  const day = "2026-08-05";
  // 09:00–13:00 hora local de Buenos Aires.
  const inHours = { startsAt: "2026-08-05T12:00:00Z", endsAt: "2026-08-05T16:00:00Z" };

  it("defaults to the 09:00–17:00 workday when everything fits", () => {
    expect(visibleDayWindow([inHours], day, AR)).toEqual(DEFAULT_DAY_WINDOW);
  });

  it("defaults to the workday when there are no bookings at all", () => {
    expect(visibleDayWindow([], day, AR)).toEqual(DEFAULT_DAY_WINDOW);
  });

  it("extends past 17:00 for an evening booking (Q-G)", () => {
    // 18:00–20:00 local.
    const evening = { startsAt: "2026-08-05T21:00:00Z", endsAt: "2026-08-05T23:00:00Z" };
    expect(visibleDayWindow([inHours, evening], day, AR)).toEqual({
      startMinute: 9 * 60,
      endMinute: 20 * 60,
    });
  });

  it("extends before 09:00 for an early booking", () => {
    // 07:30–09:00 local.
    const early = { startsAt: "2026-08-05T10:30:00Z", endsAt: "2026-08-05T12:00:00Z" };
    expect(visibleDayWindow([early], day, AR)).toEqual({
      startMinute: 7 * 60 + 30,
      endMinute: 17 * 60,
    });
  });

  it("extends on both ends at once", () => {
    const early = { startsAt: "2026-08-05T10:30:00Z", endsAt: "2026-08-05T12:00:00Z" };
    const evening = { startsAt: "2026-08-05T21:00:00Z", endsAt: "2026-08-05T23:00:00Z" };
    expect(visibleDayWindow([early, evening], day, AR)).toEqual({
      startMinute: 7 * 60 + 30,
      endMinute: 20 * 60,
    });
  });

  it("ignores bookings from other days", () => {
    const otherDay = { startsAt: "2026-08-06T21:00:00Z", endsAt: "2026-08-06T23:00:00Z" };
    expect(visibleDayWindow([otherDay], day, AR)).toEqual(DEFAULT_DAY_WINDOW);
  });

  it("clamps a booking that runs past midnight to the end of the day", () => {
    // 22:00 del 5 → 02:00 del 6, hora local.
    const overnight = { startsAt: "2026-08-06T01:00:00Z", endsAt: "2026-08-06T05:00:00Z" };
    expect(visibleDayWindow([overnight], day, AR).endMinute).toBe(24 * 60);
  });
});
