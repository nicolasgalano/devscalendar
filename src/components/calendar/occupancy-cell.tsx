import Link from "next/link";

import { formatHours, loadClasses, type DayLoad } from "@/lib/calendar/load";
import { cn } from "@/lib/utils";

/**
 * A day cell of the month view.
 *
 * DESIGN.md §8 and checklist 12: the ramp is reinforcement, never the carrier.
 * The booking count and the booked hours are always present as text, so the
 * cell is readable with no colour perception at all.
 */
export function OccupancyCell({
  load,
  href,
  isToday,
  isOutsideMonth,
}: {
  load: DayLoad;
  href: string;
  isToday: boolean;
  isOutsideMonth?: boolean;
}) {
  const dayNumber = Number(load.day.slice(8, 10));
  const label = describe(load);

  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "flex min-h-24 flex-col gap-1 border-b border-l border-border p-2 outline-none",
        "transition-[background-color] hover:ring-1 hover:ring-inset hover:ring-foreground/15",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        loadClasses(load),
        isOutsideMonth && "opacity-40",
      )}
    >
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "font-data text-caption",
            // Never --muted-foreground here: it drops below AA on the darker
            // ramp steps and on --muted. Measured in T2.1/T2.2.
            load.isWorkday ? "text-foreground" : "text-secondary-foreground",
            isToday &&
              "flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground",
          )}
        >
          {dayNumber}
        </span>
        {!load.isWorkday && (
          <span className="truncate text-caption text-secondary-foreground">No laborable</span>
        )}
      </span>

      {load.bookings > 0 && (
        <span className="mt-auto flex flex-col text-caption text-foreground">
          <span className="font-data">{formatHours(load.minutes)}</span>
          <span className="text-secondary-foreground">
            {load.bookings === 1 ? "1 reserva" : `${load.bookings} reservas`}
          </span>
        </span>
      )}
    </Link>
  );
}

/** Compact day square for the year view — same ramp, no text inside. */
export function MiniDayCell({ load, href }: { load: DayLoad; href: string }) {
  return (
    <Link
      href={href}
      aria-label={describe(load)}
      title={describe(load)}
      className={cn(
        "flex size-3 items-center justify-center rounded-xs outline-none",
        "hover:ring-1 hover:ring-foreground/30",
        "focus-visible:outline-2 focus-visible:outline-ring",
        loadClasses(load),
        load.level === "none" && load.isWorkday && "border border-border",
      )}
    />
  );
}

/**
 * The non-visual alternative required by DESIGN.md §12. Everything the ramp
 * encodes has to be available as text to a screen reader.
 */
function describe(load: DayLoad): string {
  const date = `${Number(load.day.slice(8, 10))}/${load.day.slice(5, 7)}`;
  if (!load.isWorkday) {
    return load.bookings > 0
      ? `${date}, día no laborable con ${load.bookings} reservas`
      : `${date}, día no laborable`;
  }
  if (load.bookings === 0) return `${date}, sin reservas`;

  const percent = load.occupancy === null ? null : Math.round(load.occupancy * 100);
  const reservas = load.bookings === 1 ? "1 reserva" : `${load.bookings} reservas`;
  return percent === null
    ? `${date}, ${reservas}`
    : `${date}, ${reservas}, ${formatHours(load.minutes)}, ${percent}% de ocupación`;
}
