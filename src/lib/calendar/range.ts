import type { CalendarView } from "@/lib/validation/calendar";

import { WORKDAY_END_HOUR, WORKDAY_START_HOUR } from "./workdays";

/** Half-open instant range: `from` inclusive, `to` exclusive. */
export type CalendarRange = { from: string; to: string };

export const MINUTES_PER_ROW = 30;

/**
 * Timezone handling lives here and nowhere else (R-2). Instants are always
 * stored in UTC; every conversion to and from a wall clock goes through these
 * helpers, so answering Q-10 with "a fixed timezone per project" later means
 * changing the `tz` argument, not the architecture.
 */

function offsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}

/** Wall clock in `tz` → the instant it refers to. */
export function zonedToInstant(
  isoDate: string,
  tz: string,
  { hour = 0, minute = 0 }: { hour?: number; minute?: number } = {},
): Date {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  const wall = Date.UTC(year, month - 1, day, hour, minute);

  // Two passes: the offset has to be sampled at the resulting instant, which is
  // only known after applying it. The second pass settles DST boundaries, where
  // the offset before and after the jump differ.
  const first = wall - offsetMs(new Date(wall), tz);
  const second = wall - offsetMs(new Date(first), tz);
  return new Date(second);
}

/** Instant → calendar date (`YYYY-MM-DD`) as seen in `tz`. */
export function instantToIsoDate(instant: Date | string, tz: string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Minutes since local midnight, in `tz`. */
export function minutesOfDay(instant: Date | string, tz: string): number {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  return get("hour") * 60 + get("minute");
}

export function todayInTimeZone(tz: string, now: Date = new Date()): string {
  return instantToIsoDate(now, tz);
}

// ── Calendar arithmetic on `YYYY-MM-DD` strings ──────────────────────────────

function toParts(isoDate: string) {
  return {
    year: Number(isoDate.slice(0, 4)),
    month: Number(isoDate.slice(5, 7)),
    day: Number(isoDate.slice(8, 10)),
  };
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, amount: number): string {
  const { year, month, day } = toParts(isoDate);
  return fromUtc(new Date(Date.UTC(year, month - 1, day + amount)));
}

export function addMonths(isoDate: string, amount: number): string {
  const { year, month, day } = toParts(isoDate);
  // Clamp the day so 31/01 + 1 month lands on 28/02 instead of rolling into
  // March, which would make "next month" skip February entirely.
  const target = new Date(Date.UTC(year, month - 1 + amount, 1));
  const daysInTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTarget));
  return fromUtc(target);
}

export function addYears(isoDate: string, amount: number): string {
  const { year, month, day } = toParts(isoDate);
  const daysInTarget = new Date(Date.UTC(year + amount, month, 0)).getUTCDate();
  return fromUtc(new Date(Date.UTC(year + amount, month - 1, Math.min(day, daysInTarget))));
}

export function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function startOfYear(isoDate: string): string {
  return `${isoDate.slice(0, 4)}-01-01`;
}

/** Every calendar date in `[from, to)`, as `YYYY-MM-DD`. */
export function eachDay(fromIsoDate: string, toIsoDateExclusive: string): string[] {
  const days: string[] = [];
  for (let day = fromIsoDate; day < toIsoDateExclusive; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

export function daysInMonth(isoDate: string): string[] {
  const start = startOfMonth(isoDate);
  return eachDay(start, addMonths(start, 1));
}

/** The 12 month anchors (`YYYY-MM-01`) of the year holding `isoDate`. */
export function monthsInYear(isoDate: string): string[] {
  const start = startOfYear(isoDate);
  return Array.from({ length: 12 }, (_, index) => addMonths(start, index));
}

// ── Ranges and navigation ────────────────────────────────────────────────────

/** Local calendar bounds of a view, as `[fromDate, toDateExclusive)`. */
export function viewBounds(view: CalendarView, isoDate: string): [string, string] {
  switch (view) {
    case "day":
      return [isoDate, addDays(isoDate, 1)];
    case "month": {
      const start = startOfMonth(isoDate);
      return [start, addMonths(start, 1)];
    }
    case "year": {
      const start = startOfYear(isoDate);
      return [start, addYears(start, 1)];
    }
  }
}

/**
 * The instant range a view covers, resolved in the viewer's timezone.
 * Half-open on purpose: it pairs with the overlap filter in `query.ts`
 * (`starts_at < to and ends_at > from`).
 */
export function resolveRange(
  view: CalendarView,
  isoDate: string,
  tz: string,
): CalendarRange {
  const [fromDate, toDate] = viewBounds(view, isoDate);
  return {
    from: zonedToInstant(fromDate, tz).toISOString(),
    to: zonedToInstant(toDate, tz).toISOString(),
  };
}

/** Previous / next step for the current view, keeping the anchor coherent. */
export function shiftDate(view: CalendarView, isoDate: string, steps: number): string {
  switch (view) {
    case "day":
      return addDays(isoDate, steps);
    case "month":
      return addMonths(startOfMonth(isoDate), steps);
    case "year":
      return addYears(startOfYear(isoDate), steps);
  }
}

// ── Visible window of the day view ───────────────────────────────────────────

export type DayWindow = {
  /** Minutes from local midnight, aligned to the 30-minute grid. */
  startMinute: number;
  endMinute: number;
};

export const DEFAULT_DAY_WINDOW: DayWindow = {
  startMinute: WORKDAY_START_HOUR * 60,
  endMinute: WORKDAY_END_HOUR * 60,
};

function floorToRow(minute: number) {
  return Math.floor(minute / MINUTES_PER_ROW) * MINUTES_PER_ROW;
}

function ceilToRow(minute: number) {
  return Math.ceil(minute / MINUTES_PER_ROW) * MINUTES_PER_ROW;
}

/**
 * `min(09:00, first start) … max(17:00, last end)`, aligned to the grid.
 *
 * Working outside the workday is exceptional (Q-G), but it is never blocked, so
 * the window is always computed rather than special-cased: one render path, no
 * rare branch that nobody exercises. A booking is never clipped — hiding
 * someone's work is worse than a taller grid.
 *
 * Bookings that spill past midnight are clamped to the day being rendered;
 * the part outside belongs to the neighbouring day.
 */
export function visibleDayWindow(
  bookings: readonly { startsAt: string; endsAt: string }[],
  isoDate: string,
  tz: string,
): DayWindow {
  const dayStart = zonedToInstant(isoDate, tz).getTime();
  const dayEnd = zonedToInstant(addDays(isoDate, 1), tz).getTime();

  let startMinute = DEFAULT_DAY_WINDOW.startMinute;
  let endMinute = DEFAULT_DAY_WINDOW.endMinute;

  for (const booking of bookings) {
    const starts = new Date(booking.startsAt).getTime();
    const ends = new Date(booking.endsAt).getTime();
    if (ends <= dayStart || starts >= dayEnd) continue;

    const localStart = starts <= dayStart ? 0 : minutesOfDay(new Date(starts), tz);
    const localEnd =
      ends >= dayEnd ? 24 * 60 : minutesOfDay(new Date(ends), tz) || 24 * 60;

    startMinute = Math.min(startMinute, floorToRow(localStart));
    endMinute = Math.max(endMinute, ceilToRow(localEnd));
  }

  return { startMinute, endMinute };
}
