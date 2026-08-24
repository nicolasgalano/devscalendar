import { capitalize, WEEKDAY_NAMES, weekdayIndex } from "@/lib/calendar/format";
import {
  isHoliday,
  isWeekend,
  loadedHolidayYears,
  UnknownHolidayYearError,
  WORKDAY_END_HOUR,
  WORKDAY_START_HOUR,
} from "@/lib/calendar/workdays";

import { parseTime } from "./form";

export type BookingWarning = {
  /** Stable key for the list, and the hook the E2E test grabs. */
  id: "non-workday" | "outside-hours" | "unknown-holidays";
  message: string;
};

const WORKDAY_LABEL = `${String(WORKDAY_START_HOUR).padStart(2, "0")}:00 a ${String(
  WORKDAY_END_HOUR,
).padStart(2, "0")}:00`;

/**
 * AC-1.4: booking outside the workday or on a non-working day is **warned, never
 * blocked**.
 *
 * The client was explicit about this (Q-G): those bookings are exceptional, not
 * routine, but they do happen — a release on a Saturday, an incident at 20:00.
 * A hard block would send the PM to fix the data by hand somewhere else, which
 * is worse than a calendar that shows an unusual booking as unusual.
 *
 * Nothing here can refuse anything: the function returns text. The dialog
 * renders it in `--attention` and leaves the save button alone.
 */
export function describeBookingWarnings(values: {
  date: string;
  startTime: string;
  endTime: string;
}): BookingWarning[] {
  const warnings: BookingWarning[] = [];

  if (isWeekend(values.date)) {
    const weekday = WEEKDAY_NAMES[weekdayIndex(values.date)]!;
    warnings.push({
      id: "non-workday",
      message: `${capitalize(weekday)}: día no laborable.`,
    });
  } else {
    try {
      if (isHoliday(values.date)) {
        warnings.push({ id: "non-workday", message: "Feriado: día no laborable." });
      }
    } catch (error) {
      // The holiday table is maintained by hand and only covers the loaded years
      // (R-7 of 003). Saying so is better than either crashing the dialog or
      // quietly implying the date was checked.
      if (!(error instanceof UnknownHolidayYearError)) throw error;
      const years = loadedHolidayYears();
      warnings.push({
        id: "unknown-holidays",
        message: `El calendario de feriados va de ${years[0]} a ${years.at(-1)}: no se puede verificar si esta fecha es feriado.`,
      });
    }
  }

  const start = parseTime(values.startTime);
  const end = parseTime(values.endTime);
  const outsideHours =
    (start !== null && start < WORKDAY_START_HOUR * 60) ||
    (end !== null && end > WORKDAY_END_HOUR * 60);

  if (outsideHours) {
    warnings.push({
      id: "outside-hours",
      message: `Fuera del horario habitual (${WORKDAY_LABEL}).`,
    });
  }

  return warnings;
}
