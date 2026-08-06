import Link from "next/link";

import { MiniDayCell } from "@/components/calendar/occupancy-cell";
import { capitalize, formatMonthName, WEEKDAY_INITIALS, weekdayIndex } from "@/lib/calendar/format";
import type { DayLoad } from "@/lib/calendar/load";
import { daysInMonth, monthsInYear } from "@/lib/calendar/range";
import { calendarHref } from "@/lib/calendar/url";
import type { CalendarParams } from "@/lib/validation/calendar";

/**
 * Twelve mini-months. AC-1.1: clicking a month opens the month view.
 *
 * Same occupancy ramp as the month view, so the reading carries over between
 * zoom levels instead of having to be learnt twice.
 */
export function YearView({
  days,
  params,
  tz,
}: {
  days: DayLoad[];
  params: CalendarParams;
  tz: string;
}) {
  const byDay = new Map(days.map((load) => [load.day, load]));

  return (
    <div className="grid gap-6 min-[1280px]:grid-cols-3 min-[1440px]:grid-cols-4 sm:grid-cols-2">
      {monthsInYear(params.date).map((monthAnchor) => {
        const monthDays = daysInMonth(monthAnchor);
        const leadingBlanks = weekdayIndex(monthDays[0]!);

        return (
          <section key={monthAnchor} className="rounded-lg border border-border p-3">
            <h2 className="pb-2">
              <Link
                href={calendarHref(params, { view: "month", date: monthAnchor })}
                className="rounded-sm text-emphasis font-medium outline-none hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
              >
                {capitalize(formatMonthName(monthAnchor, tz))}
              </Link>
            </h2>

            <div className="grid grid-cols-7 gap-1">
              {WEEKDAY_INITIALS.map((initial, index) => (
                <span
                  key={`${monthAnchor}-head-${index}`}
                  aria-hidden="true"
                  className="text-center text-caption text-muted-foreground"
                >
                  {initial}
                </span>
              ))}

              {Array.from({ length: leadingBlanks }, (_, index) => (
                <span key={`${monthAnchor}-blank-${index}`} aria-hidden="true" />
              ))}

              {monthDays.map((day) => {
                const load = byDay.get(day);
                return load ? (
                  <MiniDayCell
                    key={day}
                    load={load}
                    href={calendarHref(params, { view: "day", date: day })}
                  />
                ) : (
                  <span key={day} aria-hidden="true" className="size-3" />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
