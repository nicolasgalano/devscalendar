import { OccupancyCell } from "@/components/calendar/occupancy-cell";
import { WEEKDAY_INITIALS, WEEKDAY_NAMES, weekdayIndex } from "@/lib/calendar/format";
import type { DayLoad } from "@/lib/calendar/load";
import { calendarHref } from "@/lib/calendar/url";
import type { CalendarParams } from "@/lib/validation/calendar";

/**
 * Month grid: seven columns, week starting on Monday.
 *
 * AC-1.2: clicking a day opens the day view — including non-working days, since
 * a booking on a Saturday is allowed and has to be reachable.
 */
export function MonthView({
  days,
  params,
  today,
}: {
  days: DayLoad[];
  params: CalendarParams;
  today: string;
}) {
  const first = days[0];
  if (!first) return null;

  // Blank cells before the 1st, so the month starts on its real weekday.
  const leadingBlanks = weekdayIndex(first.day);

  return (
    <div className="overflow-hidden rounded-lg border-t border-r border-border">
      <div className="grid grid-cols-7">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <div
            key={WEEKDAY_NAMES[index]}
            className="border-b border-l border-border px-2 py-1.5"
          >
            {/* §11: sentence case, no shouting caps. The full name stays
                available to screen readers, since a lone "M" is ambiguous. */}
            <abbr
              title={WEEKDAY_NAMES[index]}
              className="text-caption font-medium text-muted-foreground no-underline"
            >
              {initial}
            </abbr>
          </div>
        ))}

        {Array.from({ length: leadingBlanks }, (_, index) => (
          <div
            key={`blank-${index}`}
            aria-hidden="true"
            className="min-h-24 border-b border-l border-border bg-surface"
          />
        ))}

        {days.map((load) => (
          <OccupancyCell
            key={load.day}
            load={load}
            isToday={load.day === today}
            href={calendarHref(params, { view: "day", date: load.day })}
          />
        ))}
      </div>
    </div>
  );
}
