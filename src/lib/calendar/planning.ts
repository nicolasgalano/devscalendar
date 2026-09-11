import type { ProjectPriority } from "@/lib/validation/calendar";

import type { CalendarBooking, DevDayLoadRow } from "./query";
import { addDays, instantToIsoDate, zonedToInstant } from "./range";

/**
 * Cell of the planning matrix.
 *
 * `hoursApproved` and `hoursPending` are what the number in the cell displays;
 * `bookingIds` also carries `displaced`, because the popover lists them for
 * traceability even though they no longer contribute hours (`plan.md` §4.2).
 */
export type PlanningCell = {
  hoursApproved: number;
  hoursPending: number;
  bookingIds: string[];
};

export type PlanningRow = {
  client: { id: string; name: string };
  project: { id: string; name: string; priority: ProjectPriority };
  dev: { id: string; name: string };
  /** Key = iso date. Only days with at least one contribution are stored. */
  cells: Map<string, PlanningCell>;
};

/**
 * Splits a booking into per-day minutes, on the local calendar.
 *
 * A booking `22:00–02:00` counts 2 h for day X and 2 h for day X+1 (Q-P2). The
 * split lives in local time —not UTC— because the calendar day is a local
 * concept: doing it in UTC would drift by up to a day in negative-offset zones.
 */
export function splitBookingByDay(
  booking: { startsAt: string; endsAt: string },
  tz: string,
): Array<{ isoDate: string; minutes: number }> {
  const starts = Date.parse(booking.startsAt);
  const ends = Date.parse(booking.endsAt);
  if (!(ends > starts)) return [];

  const result: Array<{ isoDate: string; minutes: number }> = [];
  let day = instantToIsoDate(new Date(starts), tz);
  const lastDay = instantToIsoDate(new Date(ends - 1), tz);

  while (day <= lastDay) {
    const dayStart = zonedToInstant(day, tz).getTime();
    const dayEnd = zonedToInstant(addDays(day, 1), tz).getTime();
    const overlap = Math.min(ends, dayEnd) - Math.max(starts, dayStart);
    if (overlap > 0) result.push({ isoDate: day, minutes: overlap / 60_000 });
    day = addDays(day, 1);
  }

  return result;
}

type RowKey = `${string}::${string}::${string}`;

function rowKey(clientId: string, projectId: string, devId: string): RowKey {
  return `${clientId}::${projectId}::${devId}`;
}

/**
 * Builds the planning matrix from the visible bookings.
 *
 * One row per `(client, project, dev)` combination that has at least one
 * booking in the window, sorted alphabetically. This is the operative
 * definition of "there was a commitment" in the current model: without a
 * `project_devs` table (plan §3.2), the relation only exists through bookings.
 *
 * Hours count only `approved` and `pending`; `displaced` bookings surface in
 * `bookingIds` for the popover but do not add hours — they are no longer
 * committed.
 */
export function buildPlanningMatrix(
  bookings: readonly CalendarBooking[],
  days: readonly string[],
  tz: string,
): PlanningRow[] {
  const daySet = new Set(days);
  const rows = new Map<RowKey, PlanningRow>();

  for (const booking of bookings) {
    if (booking.status === "rejected" || booking.status === "cancelled") continue;

    const key = rowKey(booking.project.client.id, booking.project.id, booking.dev.id);
    let row = rows.get(key);
    if (!row) {
      row = {
        client: booking.project.client,
        project: {
          id: booking.project.id,
          name: booking.project.name,
          priority: booking.project.priority,
        },
        dev: booking.dev,
        cells: new Map(),
      };
      rows.set(key, row);
    }

    const counts = booking.status !== "displaced";
    for (const share of splitBookingByDay(booking, tz)) {
      if (!daySet.has(share.isoDate)) continue;
      const cell = row.cells.get(share.isoDate) ?? {
        hoursApproved: 0,
        hoursPending: 0,
        bookingIds: [],
      };
      if (counts) {
        const hours = share.minutes / 60;
        if (booking.status === "approved") cell.hoursApproved += hours;
        else if (booking.status === "pending") cell.hoursPending += hours;
      }
      // A booking that touches a cell shows up in its popover even when it
      // does not add hours (displaced): traceability, per plan §4.4.
      if (!cell.bookingIds.includes(booking.id)) cell.bookingIds.push(booking.id);
      row.cells.set(share.isoDate, cell);
    }
  }

  return Array.from(rows.values()).sort(compareRows);
}

function compareRows(a: PlanningRow, b: PlanningRow): number {
  const client = a.client.name.localeCompare(b.client.name, "es");
  if (client !== 0) return client;
  const project = a.project.name.localeCompare(b.project.name, "es");
  if (project !== 0) return project;
  return a.dev.name.localeCompare(b.dev.name, "es");
}

/**
 * Total hours committed by each developer per day.
 *
 * Built from the unfiltered dev-day query (`getDevDayLoad`), not from the
 * matrix input: overload has to count *all* the developer's work, even the
 * projects the current filter hides. Anything else would let a PM think a
 * developer is free when they are not — the exact bug the view exists to
 * prevent (`plan.md` §5, R-1).
 */
export function computeDevDayLoad(
  rows: readonly DevDayLoadRow[],
  days: readonly string[],
  tz: string,
): Map<string, number> {
  const daySet = new Set(days);
  const totals = new Map<string, number>();

  for (const row of rows) {
    for (const share of splitBookingByDay(row, tz)) {
      if (!daySet.has(share.isoDate)) continue;
      const key = `${row.devId}::${share.isoDate}`;
      totals.set(key, (totals.get(key) ?? 0) + share.minutes / 60);
    }
  }

  return totals;
}

/** Q-P1: strict `>8h`. A full workday 09–17 is 8 h net and is *not* overload. */
export const OVERLOAD_THRESHOLD_HOURS = 8;

export function isOverloaded(hours: number | undefined): boolean {
  return hours !== undefined && hours > OVERLOAD_THRESHOLD_HOURS;
}

/**
 * Contributions of each project to a dev's day, from the unfiltered dev-day
 * load. Feeds the tooltip AC-2.2 requires.
 *
 * **Takes `DevDayLoadRow[]`, not the filtered bookings array, on purpose.** A
 * PM who filters by their client would otherwise see a tooltip that lists only
 * their own projects — and the overload outline would go unexplained for the
 * hours coming from the projects the filter hid. That is the exact failure
 * mode of `plan.md` R-1.
 */
export type OverloadContribution = {
  projectId: string;
  projectName: string;
  hours: number;
  /**
   * The same hours split by commitment. R-5 of `plan.md` §10: the grid obeys the
   * status filter and this total does not, so a PM looking at approved-only
   * hours can read an overload bigger than anything on screen. Naming which
   * hours are confirmed and which are still pending is what lets the two
   * figures be reconciled by reading, instead of looking like a contradiction.
   */
  hoursApproved: number;
  hoursPending: number;
};

export function overloadContributions(
  devId: string,
  isoDate: string,
  rows: readonly DevDayLoadRow[],
  tz: string,
): OverloadContribution[] {
  const perProject = new Map<string, Omit<OverloadContribution, "projectId">>();

  for (const row of rows) {
    if (row.devId !== devId) continue;
    for (const share of splitBookingByDay(row, tz)) {
      if (share.isoDate !== isoDate) continue;
      const entry = perProject.get(row.projectId) ?? {
        projectName: row.projectName,
        hours: 0,
        hoursApproved: 0,
        hoursPending: 0,
      };
      const hours = share.minutes / 60;
      entry.hours += hours;
      if (row.status === "approved") entry.hoursApproved += hours;
      else entry.hoursPending += hours;
      perProject.set(row.projectId, entry);
    }
  }

  return Array.from(perProject.entries())
    .map(([projectId, entry]) => ({ projectId, ...entry }))
    .sort((a, b) => b.hours - a.hours);
}
