import { PlanningCell } from "@/components/calendar/planning-cell";
import { WEEKDAY_INITIALS } from "@/lib/calendar/format";
import {
  isOverloaded,
  overloadContributions,
  type PlanningRow,
} from "@/lib/calendar/planning";
import type { CalendarBooking, DevDayLoadRow } from "@/lib/calendar/query";
import { calendarHref } from "@/lib/calendar/url";
import { isWorkday } from "@/lib/calendar/workdays";
import { cn } from "@/lib/utils";
import type { CalendarParams } from "@/lib/validation/calendar";

/** DESIGN.md §5 + plan §7.1: compact cell that fits four weeks on 1280px. */
const CELL_WIDTH = 40;
const LABEL_WIDTH = 240;
const ROW_HEIGHT = 36;

/**
 * Planning grid: `client > project > dev` rows, 28 day columns.
 *
 * Read-only by design (`plan.md` §1). Creation, edition and cancellation live
 * in the day view. Cells with hours open a popover with the concrete bookings;
 * empty cells on a workday do nothing on click — the affordance would suggest
 * a create flow the vista intentionally does not carry.
 */
export function PlanningView({
  rows,
  days,
  devDayLoad,
  bookings,
  overload,
  params,
  tz,
}: {
  rows: PlanningRow[];
  days: string[];
  devDayLoad: DevDayLoadRow[];
  /** Filtered bookings, indexed by id for popover lookup. */
  bookings: Map<string, CalendarBooking>;
  overload: Map<string, number>;
  params: CalendarParams;
  tz: string;
}) {
  // One template for header and body rows: same trick as the day view — a
  // single `grid-template-columns` is what guarantees each column measures the
  // same everywhere.
  const gridTemplateColumns = `${LABEL_WIDTH}px repeat(${days.length}, ${CELL_WIDTH}px)`;

  const weekSpans = groupByWeek(days);

  // Emit hierarchical header rows (client, project) between the data rows so
  // the vista reads like the sheet it replaces. Walks the sorted list and
  // compares against the previous row's client / project ids.
  const layoutRows = buildLayoutRows(rows);

  return (
    // `overflow-auto` sobre el contenedor: los sticky de la cabecera y de la
    // columna izquierda se anclan a *este* elemento, no al viewport, así el
    // scroll horizontal y el vertical se resuelven cada uno por su lado sin
    // romper la ancla del otro (DESIGN.md §6).
    <div className="border-border relative max-h-[calc(100vh-14rem)] overflow-auto rounded-lg border">
      <div className="inline-grid min-w-full" style={{ gridTemplateColumns }}>
        <WeekHeader spans={weekSpans} />
        <DayHeader days={days} />

        {layoutRows.map((row) => {
          if (row.kind === "client") {
            return (
              <HeaderRow
                key={`client-${row.clientId}`}
                label={row.clientName}
                dayCount={days.length}
                labelClass="text-emphasis font-medium"
                labelPad="pl-3"
              />
            );
          }
          if (row.kind === "project") {
            return (
              <HeaderRow
                key={`project-${row.projectId}`}
                label={row.projectName}
                dayCount={days.length}
                labelClass="text-ui font-medium text-secondary-foreground"
                labelPad="pl-6"
              />
            );
          }

          const { data } = row;
          return (
            <div key={`dev-${row.rowId}`} className="contents">
              <div
                className={cn(
                  "border-border bg-background sticky left-0 z-10 flex items-center border-t border-r pr-2 pl-9",
                  "text-ui text-foreground truncate",
                )}
                style={{ minHeight: ROW_HEIGHT }}
              >
                {data.dev.name}
              </div>

              {days.map((day) => {
                const cell = data.cells.get(day);
                const workday = isWorkday(day);
                const overloadHours = overload.get(`${data.dev.id}::${day}`);
                const overloaded = workday && isOverloaded(overloadHours);
                const cellBookings = cell
                  ? cell.bookingIds
                      .map((id) => bookings.get(id))
                      .filter((entry): entry is CalendarBooking => Boolean(entry))
                  : [];

                return (
                  <PlanningCell
                    key={`${row.rowId}-${day}`}
                    day={day}
                    workday={workday}
                    hoursApproved={cell?.hoursApproved ?? 0}
                    hoursPending={cell?.hoursPending ?? 0}
                    bookings={cellBookings}
                    overloaded={overloaded}
                    overloadHours={overloadHours ?? 0}
                    contributions={
                      overloaded
                        ? overloadContributions(data.dev.id, day, devDayLoad, tz)
                        : []
                    }
                    devName={data.dev.name}
                    tz={tz}
                    dayHref={calendarHref(params, { view: "day", date: day })}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Layout rows ──────────────────────────────────────────────────────────────

type LayoutRow =
  | { kind: "client"; clientId: string; clientName: string }
  | { kind: "project"; projectId: string; projectName: string }
  | { kind: "dev"; rowId: string; data: PlanningRow };

function buildLayoutRows(rows: readonly PlanningRow[]): LayoutRow[] {
  const out: LayoutRow[] = [];
  let lastClient: string | null = null;
  let lastProject: string | null = null;

  for (const row of rows) {
    if (row.client.id !== lastClient) {
      out.push({ kind: "client", clientId: row.client.id, clientName: row.client.name });
      lastClient = row.client.id;
      lastProject = null;
    }
    if (row.project.id !== lastProject) {
      out.push({
        kind: "project",
        projectId: row.project.id,
        projectName: row.project.name,
      });
      lastProject = row.project.id;
    }
    out.push({
      kind: "dev",
      rowId: `${row.client.id}::${row.project.id}::${row.dev.id}`,
      data: row,
    });
  }

  return out;
}

// ── Headers ──────────────────────────────────────────────────────────────────

function WeekHeader({ spans }: { spans: WeekSpan[] }) {
  return (
    <div className="contents">
      <div
        aria-hidden="true"
        className="border-border bg-background sticky top-0 left-0 z-30 border-b"
        style={{ minHeight: 28 }}
      />
      {spans.map((span) => (
        <div
          key={span.start}
          className="border-border bg-background text-caption text-muted-foreground sticky top-0 z-20 flex items-center justify-center truncate border-b border-l px-1 font-medium"
          style={{ minHeight: 28, gridColumn: `span ${span.length}` }}
        >
          {span.label}
        </div>
      ))}
    </div>
  );
}

function DayHeader({ days }: { days: string[] }) {
  return (
    <div className="contents">
      <div
        aria-hidden="true"
        className="border-border bg-background sticky top-[28px] left-0 z-30 border-b"
        style={{ minHeight: 32 }}
      />
      {days.map((day) => {
        const weekday = weekdayInitial(day);
        const dayNumber = Number(day.slice(8, 10));
        const workday = isWorkday(day);
        return (
          <div
            key={day}
            className={cn(
              "border-border sticky top-[28px] z-20 flex flex-col items-center justify-center border-b border-l",
              workday ? "bg-background" : "bg-muted",
            )}
            style={{ minHeight: 32 }}
          >
            <span className="text-caption text-muted-foreground leading-none">
              {weekday}
            </span>
            <span
              className={cn(
                "font-data text-caption leading-none",
                workday ? "text-foreground" : "text-secondary-foreground",
              )}
              // Absolute date on hover, for accessibility parity with the
              // other views (DESIGN.md §11).
              title={formatIsoDate(day)}
            >
              {dayNumber}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function HeaderRow({
  label,
  dayCount,
  labelClass,
  labelPad,
}: {
  label: string;
  dayCount: number;
  labelClass: string;
  labelPad: string;
}) {
  return (
    <div className="contents">
      <div
        className={cn(
          "border-border bg-background sticky left-0 z-10 flex items-center border-t border-r truncate",
          labelClass,
          labelPad,
        )}
        style={{ minHeight: ROW_HEIGHT }}
      >
        {label}
      </div>
      <div
        aria-hidden="true"
        className="border-border border-t border-l bg-background"
        style={{ minHeight: ROW_HEIGHT, gridColumn: `span ${dayCount}` }}
      />
    </div>
  );
}

// ── Week grouping ────────────────────────────────────────────────────────────

type WeekSpan = { start: string; length: number; label: string };

function groupByWeek(days: readonly string[]): WeekSpan[] {
  const spans: WeekSpan[] = [];
  let current: WeekSpan | null = null;

  for (const day of days) {
    // Uses the same UTC parse trick as `mondayOf` / `isWeekend`: parse the
    // date as UTC to avoid the runtime zone shifting the weekday.
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    // Monday-based week number: increment when weekday === 1 (Monday).
    if (!current || weekday === 1) {
      current = { start: day, length: 0, label: "" };
      spans.push(current);
    }
    current.length += 1;
  }

  for (const span of spans) {
    const last = addIso(span.start, span.length - 1);
    span.label = `${shortDate(span.start)} – ${shortDate(last)}`;
  }

  return spans;
}

function shortDate(isoDate: string): string {
  return `${Number(isoDate.slice(8, 10))}/${Number(isoDate.slice(5, 7))}`;
}

function addIso(isoDate: string, amount: number): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day + amount))
    .toISOString()
    .slice(0, 10);
}

function weekdayInitial(isoDate: string): string {
  // Monday-based initial (`L M M J V S D`).
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  const index = (weekday + 6) % 7;
  return WEEKDAY_INITIALS[index]!;
}

function formatIsoDate(isoDate: string): string {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;
}
