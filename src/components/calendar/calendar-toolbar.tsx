import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { formatRangeLabel } from "@/lib/calendar/format";
import { shiftDate } from "@/lib/calendar/range";
import { calendarHref } from "@/lib/calendar/url";
import { cn } from "@/lib/utils";
import type { CalendarParams, CalendarView } from "@/lib/validation/calendar";

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "year", label: "Año" },
  { value: "month", label: "Mes" },
  { value: "day", label: "Día" },
];

const GROUPS = [
  { value: "dev", label: "Por desarrollador" },
  { value: "project", label: "Por proyecto" },
] as const;

/**
 * View switch, range navigation and grouping.
 *
 * Every control is a plain link that carries the rest of the state, which is
 * what satisfies AC-1.3 and AC-4.1 with no client-side state at all: changing
 * the view or the month cannot lose a filter, because the filter travels in the
 * href. It also keeps this a Server Component and makes the back button work.
 */
export function CalendarToolbar({ params, today, tz }: { params: CalendarParams; today: string; tz: string }) {
  const previous = calendarHref(params, { date: shiftDate(params.view, params.date, -1) });
  const next = calendarHref(params, { date: shiftDate(params.view, params.date, 1) });

  return (
    <div className="flex flex-wrap items-center gap-2 pb-4">
      {/*
        Links, no botones. Navegan a otra URL, así que tienen que anunciarse
        como enlaces: `Button` de Base UI con `nativeButton={false}` le pone
        `role="button"` al `<a>` y un lector de pantalla deja de ofrecerlos en
        la lista de enlaces. Se reusa `buttonVariants` para que se vean igual.
      */}
      <div className="flex items-center gap-1">
        <Link
          href={previous}
          aria-label="Período anterior"
          className={buttonVariants({ variant: "outline", size: "icon-sm" })}
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Link>
        <Link
          href={next}
          aria-label="Período siguiente"
          className={buttonVariants({ variant: "outline", size: "icon-sm" })}
        >
          <ChevronRightIcon aria-hidden="true" />
        </Link>
        <Link
          href={calendarHref(params, { date: today })}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Hoy
        </Link>
      </div>

      <p aria-live="polite" className="min-w-0 flex-1 truncate text-emphasis font-medium">
        {formatRangeLabel(params.view, params.date, tz)}
      </p>

      {/* Grouping only changes the day view: the month and year views aggregate
          every lane into one number, so offering the switch there would be a
          control that does nothing. */}
      {params.view === "day" && (
        <SegmentedLinks
          label="Agrupar"
          options={GROUPS.map((group) => ({
            label: group.label,
            href: calendarHref(params, { group: group.value }),
            active: params.group === group.value,
          }))}
        />
      )}

      <SegmentedLinks
        label="Vista"
        options={VIEWS.map((view) => ({
          label: view.label,
          href: calendarHref(params, { view: view.value }),
          active: params.view === view.value,
        }))}
      />
    </div>
  );
}

function SegmentedLinks({
  label,
  options,
}: {
  label: string;
  options: { label: string; href: string; active: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex h-8 items-center rounded-md border border-border p-0.5">
      {options.map((option) => (
        <Link
          key={option.href}
          href={option.href}
          aria-current={option.active ? "true" : undefined}
          className={cn(
            "flex h-7 items-center rounded-sm px-2.5 text-ui outline-none",
            "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            option.active
              ? "bg-surface-active font-medium text-primary"
              : "text-secondary-foreground hover:bg-surface-hover hover:text-foreground",
          )}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}
