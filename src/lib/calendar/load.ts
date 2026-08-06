import { addDays, instantToIsoDate, zonedToInstant } from "./range";
import { isWorkday, WORKDAY_MINUTES } from "./workdays";

export type LoadLevel = "none" | "low" | "medium" | "high" | "full" | "over";

export type DayLoad = {
  /** `YYYY-MM-DD` in the viewer's timezone. */
  day: string;
  bookings: number;
  minutes: number;
  /** Booked minutes over capacity, or `null` on a non-working day. */
  occupancy: number | null;
  level: LoadLevel;
  isWorkday: boolean;
};

export type LoadInput = {
  spans: readonly { id: string; startsAt: string; endsAt: string }[];
  days: readonly string[];
  tz: string;
  /** Developers whose capacity counts — see `DayLoadData.devCount`. */
  devCount: number;
};

/**
 * Booked minutes per day, split across day boundaries.
 *
 * Bookings are meant to be intra-day (functional spec §5.1), but nothing in the
 * database enforces it — "the same day" depends on the timezone — so the
 * splitting is done properly instead of assuming. A booking that crosses
 * midnight contributes to both days, each getting its own share.
 */
function minutesPerDay(input: LoadInput): Map<string, { minutes: number; bookings: number }> {
  const perDay = new Map<string, { minutes: number; bookings: number }>();

  for (const span of input.spans) {
    const starts = Date.parse(span.startsAt);
    const ends = Date.parse(span.endsAt);
    if (!(ends > starts)) continue;

    let day = instantToIsoDate(new Date(starts), input.tz);
    const lastDay = instantToIsoDate(new Date(ends - 1), input.tz);

    while (day <= lastDay) {
      const dayStart = zonedToInstant(day, input.tz).getTime();
      const dayEnd = zonedToInstant(addDays(day, 1), input.tz).getTime();
      const overlap = Math.min(ends, dayEnd) - Math.max(starts, dayStart);

      if (overlap > 0) {
        const entry = perDay.get(day) ?? { minutes: 0, bookings: 0 };
        entry.minutes += overlap / 60_000;
        entry.bookings += 1;
        perDay.set(day, entry);
      }

      day = addDays(day, 1);
    }
  }

  return perDay;
}

/**
 * Occupancy thresholds — plan.md §6.2. Neutral up to 99%: load is not an alert
 * until it is exceeded.
 */
export function loadLevel(occupancy: number | null, minutes: number): LoadLevel {
  // Non-working day: capacity is zero, so there is no percentage to compute.
  // Any booked minute on it is over capacity by definition — and that is the
  // right signal, since a Saturday with bookings is rare and has to stand out.
  if (occupancy === null) return minutes > 0 ? "over" : "none";

  const percent = occupancy * 100;
  if (percent <= 0) return "none";
  if (percent < 34) return "low";
  if (percent < 67) return "medium";
  if (percent < 100) return "high";
  if (percent === 100) return "full";
  return "over";
}

/** Per-day aggregates for the month and year views. */
export function aggregateDayLoad(input: LoadInput): DayLoad[] {
  const perDay = minutesPerDay(input);
  const capacity = input.devCount * WORKDAY_MINUTES;

  return input.days.map((day): DayLoad => {
    const entry = perDay.get(day) ?? { minutes: 0, bookings: 0 };
    const workday = isWorkday(day);
    // Guard against a zero denominator: with no developers loaded there is no
    // capacity to be a fraction of, so occupancy is undefined, not infinite.
    const occupancy = workday && capacity > 0 ? entry.minutes / capacity : null;

    return {
      day,
      bookings: entry.bookings,
      minutes: entry.minutes,
      occupancy,
      level: loadLevel(occupancy, entry.minutes),
      isWorkday: workday,
    };
  });
}

/** Background class per level — DESIGN.md §8, tokens from `globals.css`. */
export function loadClasses(load: DayLoad): string {
  if (!load.isWorkday) return "bg-muted";

  switch (load.level) {
    case "none":
      return "bg-load-0";
    case "low":
      return "bg-load-1";
    case "medium":
      return "bg-load-2";
    case "high":
      return "bg-load-3";
    case "full":
      return "bg-attention-bg";
    case "over":
      return "bg-danger-bg";
  }
}

export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`;
}
