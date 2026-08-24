import { formatMinuteOfDay } from "@/lib/calendar/format";
import { instantToIsoDate, minutesOfDay, zonedToInstant } from "@/lib/calendar/range";
import { isoDateSchema } from "@/lib/validation/calendar";

/**
 * The booking form works in wall-clock terms — one date and two times — because
 * that is how a PM thinks about a reservation. The conversion to instants
 * happens here and nowhere else, so the timezone rule of `range.ts` (R-2) keeps
 * holding on the write path too.
 */
export type BookingFormValues = {
  projectId: string;
  devId: string;
  /** `YYYY-MM-DD` in the viewer's timezone. */
  date: string;
  /** `HH:MM`, 24-hour, in the viewer's timezone. */
  startTime: string;
  endTime: string;
  ticketRef: string;
  note: string;
};

/** Default length of a booking created by clicking an empty slot. */
export const DEFAULT_DURATION_MINUTES = 60;

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/** `"09:30"` → 570. Returns null for anything that is not a real time of day. */
export function parseTime(value: string): number | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return hour * 60 + minute;
}

/** 570 → `"09:30"`. */
export function formatTimeField(minuteOfDay: number): string {
  return formatMinuteOfDay(minuteOfDay);
}

/**
 * Form fields → the instants the API expects, or `null` if they do not describe
 * a valid span.
 *
 * The form cannot express a booking that crosses midnight: `endTime` is read on
 * the same calendar date as `startTime`, so `end <= start` is rejected rather
 * than rolled over to the next day. That is deliberate — an overnight shift
 * typed as `22:00`–`02:00` is far more likely to be a typo than an intention,
 * and the API still accepts explicit instants for the day it stops being one.
 */
export function toInstants(
  values: Pick<BookingFormValues, "date" | "startTime" | "endTime">,
  tz: string,
): { startsAt: string; endsAt: string } | null {
  if (!isoDateSchema.safeParse(values.date).success) return null;

  const start = parseTime(values.startTime);
  const end = parseTime(values.endTime);
  if (start === null || end === null) return null;
  if (end <= start) return null;

  return {
    startsAt: zonedToInstant(values.date, tz, { minute: start }).toISOString(),
    endsAt: zonedToInstant(values.date, tz, { minute: end }).toISOString(),
  };
}

/**
 * An existing booking → the fields that describe it.
 *
 * A booking that ends at or past midnight comes back with an `endTime` that is
 * not after `startTime`, so `toInstants` refuses it and the dialog says so
 * instead of saving a silently wrong span. It fails loudly, which is the only
 * acceptable behaviour for data the form cannot represent.
 */
export function fromBooking(
  booking: {
    project: { id: string };
    dev: { id: string };
    startsAt: string;
    endsAt: string;
    ticketRef: string | null;
    note: string | null;
  },
  tz: string,
): BookingFormValues {
  return {
    projectId: booking.project.id,
    devId: booking.dev.id,
    date: instantToIsoDate(booking.startsAt, tz),
    startTime: formatTimeField(minutesOfDay(booking.startsAt, tz)),
    endTime: formatTimeField(minutesOfDay(booking.endsAt, tz)),
    ticketRef: booking.ticketRef ?? "",
    note: booking.note ?? "",
  };
}

/** Empty form anchored on a date and a starting slot. */
export function blankForm({
  date,
  startMinute,
  projectId = "",
  devId = "",
}: {
  date: string;
  startMinute: number;
  projectId?: string;
  devId?: string;
}): BookingFormValues {
  return {
    projectId,
    devId,
    date,
    startTime: formatTimeField(startMinute),
    // Clamped to the end of the day so a click on the last slot of the grid
    // does not produce a span that rolls into tomorrow.
    endTime: formatTimeField(Math.min(startMinute + DEFAULT_DURATION_MINUTES, 24 * 60 - 1)),
    ticketRef: "",
    note: "",
  };
}

/** Trims optional text into what the API expects: a value, or nothing at all. */
export function optionalField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
