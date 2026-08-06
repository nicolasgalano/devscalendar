import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BookingStatus,
  CalendarFilters,
  ProjectPriority,
} from "@/lib/validation/calendar";
import type { Database } from "@/types/database";

import type { FacetRow } from "./facets";
import type { CalendarRange } from "./range";

type Client = SupabaseClient<Database>;

export type CalendarBooking = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  note: string | null;
  ticketRef: string | null;
  dev: { id: string; name: string };
  project: {
    id: string;
    name: string;
    priority: ProjectPriority;
    pmId: string;
    client: { id: string; name: string };
  };
};

/** Minimal shape for the month and year aggregates. */
export type BookingSpan = {
  id: string;
  devId: string;
  startsAt: string;
  endsAt: string;
};

export type DayLoadData = {
  spans: BookingSpan[];
  /**
   * Developers whose capacity counts towards occupancy: every active developer,
   * or just the one selected when the developer filter is on. Filtering by one
   * developer has to show *their* occupancy, not a diluted slice of the team's
   * (plan.md §6.2).
   */
  devCount: number;
};

// `dev:profiles!bookings_dev_id_fkey` — bookings points at profiles twice
// (dev_id and created_by), so PostgREST needs the constraint name to know which
// relationship to follow.
const BOOKING_COLUMNS = `
  id,
  starts_at,
  ends_at,
  status,
  note,
  ticket_ref,
  dev:profiles!bookings_dev_id_fkey (id, full_name, email),
  project:projects!inner (
    id,
    name,
    priority,
    pm_id,
    client:clients!inner (id, name)
  )
` as const;

const SPAN_COLUMNS = `
  id,
  dev_id,
  starts_at,
  ends_at,
  project:projects!inner (id)
` as const;

/**
 * Range overlap plus every active filter, for any column selection.
 *
 * The overlap is `starts_at < to and ends_at > from`, not a `between`: a
 * booking that starts before the visible range but runs into it still has to
 * show up. Getting this wrong hides work at the edges of the view, which is the
 * kind of bug nobody reports because the block simply is not there.
 *
 * Client, PM and priority live on `projects`, so they are filtered through the
 * inner embed — RLS on projects and clients still applies underneath.
 */
function bookingsQuery<Columns extends string>(
  supabase: Client,
  columns: Columns,
  { from, to }: CalendarRange,
  filters: CalendarFilters,
) {
  let query = supabase
    .from("bookings")
    .select(columns)
    .lt("starts_at", to)
    .gt("ends_at", from)
    .in("status", filters.statuses);

  if (filters.devId) query = query.eq("dev_id", filters.devId);
  if (filters.projectId) query = query.eq("project_id", filters.projectId);
  if (filters.clientId) query = query.eq("project.client_id", filters.clientId);
  if (filters.pmId) query = query.eq("project.pm_id", filters.pmId);
  if (filters.priority) query = query.eq("project.priority", filters.priority);

  return query.order("starts_at");
}

/** Bookings for the day view, with everything a block needs to render. */
export async function getBookingsInRange(
  supabase: Client,
  { range, filters }: { range: CalendarRange; filters: CalendarFilters },
): Promise<CalendarBooking[]> {
  const { data, error } = await bookingsQuery(
    supabase,
    BOOKING_COLUMNS,
    range,
    filters,
  );
  if (error) throw error;

  // No casts on the embeds on purpose: the generated types already infer their
  // shape from the select string, so a schema change surfaces here as a type
  // error instead of a null at runtime.
  return (data ?? []).map((row): CalendarBooking => {
    const { dev, project } = row;

    return {
      id: row.id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status as BookingStatus,
      note: row.note,
      ticketRef: row.ticket_ref,
      // Falling back to the email keeps a block readable for a teammate who
      // signed in with Google but has no display name yet.
      dev: { id: dev.id, name: dev.full_name ?? dev.email },
      project: {
        id: project.id,
        name: project.name,
        priority: project.priority as ProjectPriority,
        pmId: project.pm_id,
        client: project.client,
      },
    };
  });
}

/**
 * Everything the month and year views need to paint the occupancy ramp.
 *
 * The per-day aggregation happens in `load.ts`, in plain JS, not in SQL: for the
 * target volumes (200 bookings a month, 500 over three months) it is
 * irrelevant, and it avoids committing to a definition of "day" in Postgres
 * before Q-10 (timezone) is answered. If volume outgrows it, this function is
 * the only thing that changes (R-5).
 */
export async function getDayLoad(
  supabase: Client,
  { range, filters }: { range: CalendarRange; filters: CalendarFilters },
): Promise<DayLoadData> {
  const [spansResult, devCount] = await Promise.all([
    bookingsQuery(supabase, SPAN_COLUMNS, range, filters),
    countConsideredDevs(supabase, filters),
  ]);

  if (spansResult.error) throw spansResult.error;

  return {
    spans: (spansResult.data ?? []).map(
      (row): BookingSpan => ({
        id: row.id,
        devId: row.dev_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      }),
    ),
    devCount,
  };
}

const FACET_COLUMNS = `
  dev_id,
  project_id,
  dev:profiles!bookings_dev_id_fkey (id, full_name, email),
  project:projects!inner (
    id,
    name,
    pm_id,
    client_id,
    client:clients!inner (id, name),
    pm:profiles!projects_pm_id_fkey (id, full_name, email)
  )
` as const;

/**
 * The entities present in the visible range, to build the filter options from.
 *
 * Only the non-structural filters (status, priority) are applied here: the
 * entity filters are applied per facet in `deriveFacets`, because each facet has
 * to ignore its own filter. Passing them to the query would collapse every
 * select to the single value already chosen.
 */
export async function getFilterFacets(
  supabase: Client,
  { range, filters }: { range: CalendarRange; filters: CalendarFilters },
): Promise<FacetRow[]> {
  const { data, error } = await bookingsQuery(supabase, FACET_COLUMNS, range, {
    ...filters,
    clientId: null,
    projectId: null,
    devId: null,
    pmId: null,
  });

  if (error) throw error;

  const named = (person: { full_name: string | null; email: string }) =>
    person.full_name ?? person.email;

  return (data ?? []).map((row): FacetRow => {
    const { dev, project } = row;
    return {
      devId: dev.id,
      devName: named(dev),
      projectId: project.id,
      projectName: project.name,
      clientId: project.client.id,
      clientName: project.client.name,
      pmId: project.pm_id,
      // A project always has a PM (`pm_id` is not null), but the embed can come
      // back null if RLS hides that profile — a deactivated PM, say.
      pmName: project.pm ? named(project.pm) : "Sin PM",
    };
  });
}

export type SelectedFilterNames = {
  client: string | null;
  project: string | null;
  dev: string | null;
  pm: string | null;
};

/**
 * Names of the entities the filters point at, looked up by id.
 *
 * Deliberately *not* taken from the facets: those come from the bookings in
 * range, so a filter combination that matches nothing leaves the facet empty
 * and the name unresolvable — which is exactly the case where the "no results"
 * message most needs to say what is hiding the data (DESIGN.md §9).
 *
 * Only runs when there is nothing to show, so the extra round trip costs
 * nothing on the normal path.
 */
export async function getSelectedFilterNames(
  supabase: Client,
  filters: CalendarFilters,
): Promise<SelectedFilterNames> {
  const peopleIds = [filters.devId, filters.pmId].filter((id): id is string => id !== null);

  const [clientRow, projectRow, people] = await Promise.all([
    filters.clientId
      ? supabase.from("clients").select("name").eq("id", filters.clientId).maybeSingle()
      : null,
    filters.projectId
      ? supabase.from("projects").select("name").eq("id", filters.projectId).maybeSingle()
      : null,
    peopleIds.length > 0
      ? supabase.from("profiles").select("id, full_name, email").in("id", peopleIds)
      : null,
  ]);

  const personName = (id: string | null) => {
    const found = people?.data?.find((person) => person.id === id);
    return found ? (found.full_name ?? found.email) : null;
  };

  return {
    client: clientRow?.data?.name ?? null,
    project: projectRow?.data?.name ?? null,
    dev: personName(filters.devId),
    pm: personName(filters.pmId),
  };
}

/** Capacity denominator for the occupancy ramp — see `DayLoadData.devCount`. */
export async function countConsideredDevs(
  supabase: Client,
  filters: CalendarFilters,
): Promise<number> {
  if (filters.devId) return 1;

  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "developer")
    .eq("active", true);

  if (error) throw error;
  return count ?? 0;
}
