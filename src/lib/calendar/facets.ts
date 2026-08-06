import type { CalendarFilters } from "@/lib/validation/calendar";

/** One booking reduced to the entities the filters can point at. */
export type FacetRow = {
  devId: string;
  devName: string;
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  pmId: string;
  pmName: string;
};

export type FacetOption = { id: string; name: string };

export type Facets = {
  clients: FacetOption[];
  projects: FacetOption[];
  devs: FacetOption[];
  pms: FacetOption[];
};

type FacetKey = "clientId" | "projectId" | "devId" | "pmId";

/**
 * Options actually reachable from what is on screen.
 *
 * Every facet is computed **excluding its own filter**. That is the rule of
 * faceted search, and here it is the difference between usable and not: with
 * the developer filter set to Cristian, recomputing the developer facet under
 * that same filter would leave Cristian as the only option, and there would be
 * no way to switch to another developer without clearing everything first.
 *
 * The rows come from a single query of the visible range (`getFilterFacets` in
 * `query.ts`); the four facets are derived here, in plain JS, over the same
 * tuples — the same call `getDayLoad` makes for the occupancy ramp.
 */
export function deriveFacets(rows: readonly FacetRow[], filters: CalendarFilters): Facets {
  return {
    clients: optionsFor(rows, filters, "clientId", (row) => ({
      id: row.clientId,
      name: row.clientName,
    })),
    projects: optionsFor(rows, filters, "projectId", (row) => ({
      id: row.projectId,
      name: row.projectName,
    })),
    devs: optionsFor(rows, filters, "devId", (row) => ({
      id: row.devId,
      name: row.devName,
    })),
    pms: optionsFor(rows, filters, "pmId", (row) => ({
      id: row.pmId,
      name: row.pmName,
    })),
  };
}

function optionsFor(
  rows: readonly FacetRow[],
  filters: CalendarFilters,
  own: FacetKey,
  pick: (row: FacetRow) => FacetOption,
): FacetOption[] {
  const active = (["clientId", "projectId", "devId", "pmId"] as FacetKey[]).filter(
    (key) => key !== own && filters[key] !== null,
  );

  const matching = rows.filter((row) => active.every((key) => row[key] === filters[key]));

  const byId = new Map<string, FacetOption>();
  for (const row of matching) {
    const option = pick(row);
    if (!byId.has(option.id)) byId.set(option.id, option);
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}
