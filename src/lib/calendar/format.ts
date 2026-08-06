import type { CalendarView } from "@/lib/validation/calendar";

import { zonedToInstant } from "./range";

const LOCALE = "es-AR";

/**
 * DESIGN.md §11: dates in sentence case, never title case. `Intl` returns
 * "agosto" already lowercase in Spanish, so nothing is capitalised on purpose —
 * except where a label starts a sentence, handled by `capitalize`.
 */
export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatter(tz: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: tz, ...options });
}

/** `09:00` — §11: booking times are always absolute, never relative. */
export function formatTime(instant: string, tz: string): string {
  return formatter(tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(instant),
  );
}

/** `09:00–13:00`, with an en dash as in DESIGN.md §11. */
export function formatTimeRange(startsAt: string, endsAt: string, tz: string): string {
  return `${formatTime(startsAt, tz)}–${formatTime(endsAt, tz)}`;
}

/** `miércoles 5 de agosto de 2026` */
export function formatLongDate(isoDate: string, tz: string): string {
  return formatter(tz, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(zonedToInstant(isoDate, tz, { hour: 12 }));
}

/** `agosto 2026` */
export function formatMonthYear(isoDate: string, tz: string): string {
  return formatter(tz, { month: "long", year: "numeric" }).format(
    zonedToInstant(isoDate, tz, { hour: 12 }),
  );
}

/** `agosto` */
export function formatMonthName(isoDate: string, tz: string): string {
  return formatter(tz, { month: "long" }).format(zonedToInstant(isoDate, tz, { hour: 12 }));
}

/** Label of the visible range, for the toolbar. */
export function formatRangeLabel(view: CalendarView, isoDate: string, tz: string): string {
  switch (view) {
    case "day":
      return capitalize(formatLongDate(isoDate, tz));
    case "month":
      return capitalize(formatMonthYear(isoDate, tz));
    case "year":
      return isoDate.slice(0, 4);
  }
}

/** `L M M J V S D`, starting on Monday. */
export const WEEKDAY_INITIALS = ["L", "M", "M", "J", "V", "S", "D"] as const;

export const WEEKDAY_NAMES = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
] as const;

/**
 * Monday-based weekday index (0 = Monday), which is how the grid is laid out —
 * `getUTCDay` returns 0 for Sunday, and using it directly shifts every month by
 * one column.
 */
export function weekdayIndex(isoDate: string): number {
  return (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** `09:00` labels for the hour gutter of the day view. */
export function formatMinuteOfDay(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  const rest = minute % 60;
  return `${String(hour).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
