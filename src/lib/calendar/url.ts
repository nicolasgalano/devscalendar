import {
  DEFAULT_GROUP,
  DEFAULT_STATUSES,
  DEFAULT_VIEW,
  type CalendarParams,
} from "@/lib/validation/calendar";

export const CALENDAR_PATH = "/calendar";

export type CalendarParamsPatch = Partial<
  Omit<CalendarParams, "filters"> & { filters: Partial<CalendarParams["filters"]> }
>;

/**
 * Builds a calendar URL from the current state plus a patch.
 *
 * Every control on the screen — view switch, arrows, grouping, filters — goes
 * through here, which is what keeps filters alive across navigation (AC-4.1)
 * without any state management: the link already carries them.
 *
 * Values equal to the default are left out, so the common case is a short,
 * shareable URL (`/calendar?view=day&date=2026-08-05`) instead of a wall of
 * redundant params.
 */
export function calendarHref(current: CalendarParams, patch: CalendarParamsPatch = {}): string {
  const next: CalendarParams = {
    ...current,
    ...patch,
    filters: { ...current.filters, ...patch.filters },
  };

  const params = new URLSearchParams();
  if (next.view !== DEFAULT_VIEW) params.set("view", next.view);
  params.set("date", next.date);
  if (next.group !== DEFAULT_GROUP) params.set("group", next.group);

  if (next.filters.clientId) params.set("client", next.filters.clientId);
  if (next.filters.projectId) params.set("project", next.filters.projectId);
  if (next.filters.devId) params.set("dev", next.filters.devId);
  if (next.filters.pmId) params.set("pm", next.filters.pmId);
  if (next.filters.priority) params.set("priority", next.filters.priority);

  const statuses = [...next.filters.statuses].sort();
  const defaults = [...DEFAULT_STATUSES].sort();
  const isDefaultStatuses =
    statuses.length === defaults.length &&
    statuses.every((status, index) => status === defaults[index]);
  if (!isDefaultStatuses) params.set("status", next.filters.statuses.join(","));

  return `${CALENDAR_PATH}?${params.toString()}`;
}

/** Clears every filter while keeping the view, date and grouping in place. */
export function clearFiltersHref(current: CalendarParams): string {
  return calendarHref(current, {
    filters: {
      clientId: null,
      projectId: null,
      devId: null,
      pmId: null,
      priority: null,
      statuses: [...DEFAULT_STATUSES],
    },
  });
}
