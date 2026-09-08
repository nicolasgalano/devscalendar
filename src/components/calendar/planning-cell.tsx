"use client";

import Link from "next/link";
import { FlagIcon } from "lucide-react";

import { BookingStatusTag } from "@/components/calendar/booking-status";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatTimeRange } from "@/lib/calendar/format";
import { formatHours } from "@/lib/calendar/load";
import type { CalendarBooking } from "@/lib/calendar/query";
import { cn } from "@/lib/utils";

/**
 * A day cell of the planning grid.
 *
 * Four visual states (plan §7.2). Only two are interactive: a cell with hours
 * (opens the popover) and, transitively, the "day link" footer of the popover.
 * An empty workday cell **does nothing on click** (spec AC-4.2). Suggesting a
 * create flow here would either duplicate the day view's dialog or lie about
 * what the click does.
 */
export function PlanningCell({
  day,
  workday,
  hoursApproved,
  hoursPending,
  bookings,
  overloaded,
  overloadHours,
  contributions,
  devName,
  tz,
  dayHref,
}: {
  day: string;
  workday: boolean;
  hoursApproved: number;
  hoursPending: number;
  bookings: CalendarBooking[];
  overloaded: boolean;
  overloadHours: number;
  contributions: Array<{ projectId: string; projectName: string; hours: number }>;
  devName: string;
  tz: string;
  dayHref: string;
}) {
  const totalHours = hoursApproved + hoursPending;
  const hasHours = totalHours > 0;
  const hasPending = hoursPending > 0;

  const label = accessibleLabel({
    devName,
    day,
    totalHours,
    hasPending,
    workday,
    overloaded,
    overloadHours,
    contributions,
  });

  const cellClasses = cn(
    "border-border relative flex h-full items-center justify-center border-t border-l text-center outline-none",
    // §7.2: `--muted` para no laborables, coherente con vistas Mes y Año.
    !workday && "bg-muted",
    workday && "bg-background",
    // §7.2: pending sin fondo distinto — el color no es único portador de la
    // señal (DESIGN.md §8). Un borde interno punteado la marca sin competir
    // con el número.
    hasPending && "outline-secondary-foreground outline-1 outline-dashed -outline-offset-2",
    // §7.3: la sobrecarga suma un borde --danger hacia adentro. Va después de
    // pending en el orden de clases para pisar el borde punteado si ambos
    // aplican — la señal más fuerte gana. La outline se refuerza con offset
    // para no tapar el número.
    overloaded && "outline-danger outline-[1.5px] -outline-offset-[1.5px]",
  );

  if (!hasHours) {
    // Vacío: no interactivo. Sin `cursor: pointer`, sin trigger, sin popover —
    // spec AC-4.2 explícita.
    return (
      <div aria-hidden={!workday} className={cellClasses} title={workday ? undefined : label}>
        <span className="sr-only">{label}</span>
      </div>
    );
  }

  const number = formatCellHours(totalHours);

  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className={cn(cellClasses, "cursor-pointer hover:ring-foreground/15 hover:ring-1")}
      >
        <span
          className={cn(
            "font-data text-caption",
            hasPending ? "text-secondary-foreground" : "text-foreground",
          )}
        >
          {number}
        </span>
      </PopoverTrigger>

      <PopoverContent align="center" className="w-72">
        <PopoverHeader>
          <PopoverTitle className="text-emphasis">
            {devName} · {shortLongDate(day, tz)}
          </PopoverTitle>
        </PopoverHeader>

        {overloaded && (
          <div className="bg-danger-bg text-ui text-danger rounded-md px-2 py-1.5">
            <p className="font-medium">Sobrecarga: {formatCellHours(overloadHours)}</p>
            <ul className="mt-1 space-y-0.5">
              {contributions.map((entry) => (
                <li key={entry.projectId} className="flex justify-between gap-2">
                  <span className="truncate">{entry.projectName}</span>
                  <span className="font-data shrink-0">{formatCellHours(entry.hours)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="divide-border text-ui divide-y">
          {bookings.map((booking) => (
            <li key={booking.id} className="flex flex-col gap-1 py-1.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-data text-caption text-foreground">
                  {formatTimeRange(booking.startsAt, booking.endsAt, tz)}
                </span>
                <BookingStatusTag status={booking.status} className="text-caption" />
              </div>
              <div className="flex items-center gap-1.5">
                {booking.project.priority === "high" && (
                  <FlagIcon aria-hidden="true" className="text-priority-high size-3 shrink-0" />
                )}
                <span className="text-secondary-foreground truncate">
                  {booking.project.name}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <div className="border-border border-t pt-2">
          <Link
            href={dayHref}
            className="text-ui text-primary hover:underline"
          >
            Ver el día en el calendario
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function accessibleLabel({
  devName,
  day,
  totalHours,
  hasPending,
  workday,
  overloaded,
  overloadHours,
  contributions,
}: {
  devName: string;
  day: string;
  totalHours: number;
  hasPending: boolean;
  workday: boolean;
  overloaded: boolean;
  overloadHours: number;
  contributions: Array<{ projectId: string; projectName: string; hours: number }>;
}): string {
  const shortDate = `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;
  if (totalHours === 0) {
    return workday
      ? `${devName}, ${shortDate}, sin reservas`
      : `${devName}, ${shortDate}, día no laborable`;
  }
  const hoursText = formatCellHours(totalHours);
  const parts = [`${devName}`, `${shortDate}`, `${hoursText} reservadas`];
  if (hasPending) parts.push("hay pendientes");
  if (overloaded) {
    const detail = contributions
      .map((entry) => `${entry.projectName} ${formatCellHours(entry.hours)}`)
      .join(", ");
    parts.push(`sobrecarga: ${formatCellHours(overloadHours)}${detail ? ` (${detail})` : ""}`);
  }
  return parts.join(", ");
}

/** `4 h`, `2.5 h` — same rule as `formatHours` but takes hours, not minutes. */
function formatCellHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return formatHours(rounded * 60);
}

function shortLongDate(day: string, tz: string): string {
  // e.g. `vie 10/4`. Cheap to format inline, and no need for a full Intl call.
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));
  return parts;
}
