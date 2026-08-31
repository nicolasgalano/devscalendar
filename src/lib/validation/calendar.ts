import { z } from "zod";

import { projectPrioritySchema } from "./projects";

export const calendarViewSchema = z.enum(["year", "month", "day"]);
export const calendarGroupSchema = z.enum(["dev", "project"]);

/** The five states of the functional spec §5.2. */
export const bookingStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "displaced",
]);

export type CalendarView = z.infer<typeof calendarViewSchema>;
export type CalendarGroup = z.infer<typeof calendarGroupSchema>;
export type BookingStatus = z.infer<typeof bookingStatusSchema>;
export type ProjectPriority = z.infer<typeof projectPrioritySchema>;

/**
 * What the calendar shows unless someone asks for more. The status filter
 * brings the rest back.
 *
 * Only `cancelled` is hidden. The rule used to be "hide the terminal states",
 * which put `rejected` on the same side as `cancelled` — harmless while nothing
 * in the app could reach it, since only the seed produced rejections.
 *
 * `005` made it reachable and the omission became a hole: with notifications
 * deferred to `010`, a PM had no way to learn their booking was turned down
 * except by switching on a filter they had no reason to know they needed. It
 * also contradicted `DESIGN.md` §8, which puts rejected and displaced in the
 * same class — the two that force the PM to reassign — while this list showed
 * one and hid the other.
 *
 * A cancellation is different, and stays hidden: it was the PM's own decision,
 * so nobody has to be told about it.
 */
export const DEFAULT_STATUSES: readonly BookingStatus[] = [
  "pending",
  "approved",
  "rejected",
  "displaced",
];

export const DEFAULT_VIEW: CalendarView = "month";
export const DEFAULT_GROUP: CalendarGroup = "dev";

/** `YYYY-MM-DD`, and a real date — the regex alone accepts 2026-13-45. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Fecha inexistente");

export type CalendarFilters = {
  clientId: string | null;
  projectId: string | null;
  devId: string | null;
  pmId: string | null;
  statuses: BookingStatus[];
  priority: ProjectPriority | null;
};

export type CalendarParams = {
  view: CalendarView;
  /** Anchor of the range, `YYYY-MM-DD`. */
  date: string;
  group: CalendarGroup;
  filters: CalendarFilters;
};

/** What Next.js hands over in `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const optionalUuid = z.string().uuid().nullable().catch(null);

function parseStatuses(value: string | undefined): BookingStatus[] {
  if (!value) return [...DEFAULT_STATUSES];
  const parsed = value
    .split(",")
    .map((entry) => bookingStatusSchema.safeParse(entry.trim()))
    .flatMap((result) => (result.success ? [result.data] : []));
  // An empty selection is not a meaningful filter — it would render an empty
  // calendar with no way to tell "nothing matches" from "nothing selected".
  return parsed.length > 0 ? [...new Set(parsed)] : [...DEFAULT_STATUSES];
}

/**
 * Reads the whole calendar state out of the URL. The URL is the single source
 * of truth for view, range, grouping and filters (plan.md §4), which is what
 * makes filters survive navigation (AC-4.1) for free.
 *
 * Never throws: a hand-edited or stale query string falls back to the defaults
 * instead of erroring out. A calendar that 404s because someone mangled a
 * search param would be a terrible trade.
 *
 * @param today Anchor used when `date` is missing or invalid, as `YYYY-MM-DD`
 *              in the viewer's timezone. Passed in rather than read from the
 *              clock so the function stays pure and testable.
 */
export function parseCalendarParams(
  raw: RawSearchParams,
  { today }: { today: string },
): CalendarParams {
  return {
    view: calendarViewSchema.catch(DEFAULT_VIEW).parse(first(raw.view)),
    date: isoDateSchema.catch(today).parse(first(raw.date)),
    group: calendarGroupSchema.catch(DEFAULT_GROUP).parse(first(raw.group)),
    filters: {
      clientId: optionalUuid.parse(first(raw.client) ?? null),
      projectId: optionalUuid.parse(first(raw.project) ?? null),
      devId: optionalUuid.parse(first(raw.dev) ?? null),
      pmId: optionalUuid.parse(first(raw.pm) ?? null),
      statuses: parseStatuses(first(raw.status)),
      priority: projectPrioritySchema
        .nullable()
        .catch(null)
        .parse(first(raw.priority) ?? null),
    },
  };
}

/**
 * Whether the user narrowed the view. Drives the difference between the empty
 * state and the "no results" state (DESIGN.md §9): with no filters applied an
 * empty range means there is nothing to show, not that the filters are wrong.
 */
export function hasActiveFilters(filters: CalendarFilters): boolean {
  return (
    filters.clientId !== null ||
    filters.projectId !== null ||
    filters.devId !== null ||
    filters.pmId !== null ||
    filters.priority !== null ||
    !sameStatuses(filters.statuses, DEFAULT_STATUSES)
  );
}

function sameStatuses(a: readonly BookingStatus[], b: readonly BookingStatus[]) {
  return a.length === b.length && a.every((status) => b.includes(status));
}
