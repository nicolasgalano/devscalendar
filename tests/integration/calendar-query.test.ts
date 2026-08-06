import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveFacets } from "@/lib/calendar/facets";
import {
  countConsideredDevs,
  getBookingsInRange,
  getDayLoad,
  getFilterFacets,
} from "@/lib/calendar/query";
import { DEFAULT_STATUSES, type CalendarFilters } from "@/lib/validation/calendar";
import type { Database } from "@/types/database";

import {
  cleanupBookings,
  cleanupClient,
  cleanupProject,
  createBookingRows,
  createClientRow,
  createProjectRow,
  createUserWithRole,
  deleteTestUser,
  signInClient,
} from "./helpers";

const password = "Test-password-123!";

const noFilters: CalendarFilters = {
  clientId: null,
  projectId: null,
  devId: null,
  pmId: null,
  statuses: [...DEFAULT_STATUSES],
  priority: null,
};

/** 2026-08-05, local Buenos Aires time (UTC-3), as a UTC instant. */
const at = (hour: number) =>
  new Date(Date.parse("2026-08-05T03:00:00Z") + hour * 3_600_000).toISOString();

const DAY = { from: at(0), to: at(24) };

describe("calendar query layer", () => {
  let pm: { id: string; email: string };
  let otherPm: { id: string; email: string };
  let devA: { id: string };
  let devB: { id: string };
  let clientA: string;
  let clientB: string;
  let projectNormal: string;
  let projectHigh: string;
  let client: SupabaseClient<Database>;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const pmUser = await createUserWithRole(`cq-pm-${suffix}@example.com`, password, "pm");
    const otherPmUser = await createUserWithRole(
      `cq-pm2-${suffix}@example.com`,
      password,
      "pm",
    );
    const devAUser = await createUserWithRole(
      `cq-dev-a-${suffix}@example.com`,
      password,
      "developer",
    );
    const devBUser = await createUserWithRole(
      `cq-dev-b-${suffix}@example.com`,
      password,
      "developer",
    );

    pm = { id: pmUser.id, email: pmUser.email! };
    otherPm = { id: otherPmUser.id, email: otherPmUser.email! };
    devA = { id: devAUser.id };
    devB = { id: devBUser.id };

    clientA = (await createClientRow(`CQ cliente A ${suffix}`)).id;
    clientB = (await createClientRow(`CQ cliente B ${suffix}`)).id;
    projectNormal = (
      await createProjectRow({
        name: `CQ común ${suffix}`,
        clientId: clientA,
        pmId: pm.id,
        priority: "normal",
      })
    ).id;
    projectHigh = (
      await createProjectRow({
        name: `CQ prioritario ${suffix}`,
        clientId: clientB,
        pmId: otherPm.id,
        priority: "high",
      })
    ).id;

    await createBookingRows([
      // Inside the day.
      { projectId: projectNormal, devId: devA.id, startsAt: at(9), endsAt: at(13) },
      { projectId: projectHigh, devId: devB.id, startsAt: at(10), endsAt: at(17), status: "pending" },
      // Terminal state: excluded by the default status filter.
      { projectId: projectNormal, devId: devA.id, startsAt: at(14), endsAt: at(15), status: "cancelled" },
      // Starts the day before and runs into the range.
      {
        projectId: projectNormal,
        devId: devB.id,
        startsAt: new Date(Date.parse(at(0)) - 2 * 3_600_000).toISOString(),
        endsAt: at(2),
      },
      // Ends exactly at `from`.
      {
        projectId: projectNormal,
        devId: devA.id,
        startsAt: new Date(Date.parse(at(0)) - 3_600_000).toISOString(),
        endsAt: at(0),
      },
      // Starts exactly at `to`.
      { projectId: projectNormal, devId: devA.id, startsAt: at(24), endsAt: at(26) },
    ]);

    client = await signInClient(pm.email, password);
  });

  afterAll(async () => {
    try {
      await cleanupBookings([projectNormal, projectHigh]);
      await cleanupProject(projectNormal);
      await cleanupProject(projectHigh);
      await cleanupClient(clientA);
      await cleanupClient(clientB);
    } finally {
      await deleteTestUser(pm.id);
      await deleteTestUser(otherPm.id);
      await deleteTestUser(devA.id);
      await deleteTestUser(devB.id);
    }
  });

  async function inRange(filters: Partial<CalendarFilters> = {}) {
    const rows = await getBookingsInRange(client, {
      range: DAY,
      filters: { ...noFilters, ...filters },
    });
    // Other tests and the seed share the database, so scope to this fixture.
    return rows.filter((row) => [projectNormal, projectHigh].includes(row.project.id));
  }

  it("returns the bookings of the day with their project and client", async () => {
    const rows = await inRange();
    const project = rows.find((row) => row.project.id === projectHigh);

    expect(project?.project.priority).toBe("high");
    expect(project?.project.client.name).toMatch(/CQ cliente B/);
    expect(project?.dev.id).toBe(devB.id);
  });

  /**
   * The overlap has to be `starts_at < to and ends_at > from`. A `between`
   * would drop this row, and the bug is invisible: the block simply is not
   * there, and nobody reports what they cannot see.
   */
  it("includes a booking that starts before the range and runs into it", async () => {
    const rows = await inRange();
    const crossing = rows.filter((row) => Date.parse(row.startsAt) < Date.parse(DAY.from));

    expect(crossing).toHaveLength(1);
    expect(Date.parse(crossing[0]!.endsAt)).toBeGreaterThan(Date.parse(DAY.from));
  });

  it("excludes a booking that ends exactly when the range starts", async () => {
    const rows = await inRange();
    expect(rows.some((row) => row.endsAt === DAY.from)).toBe(false);
  });

  it("excludes a booking that starts exactly when the range ends", async () => {
    const rows = await inRange();
    expect(rows.some((row) => row.startsAt === DAY.to)).toBe(false);
  });

  it("hides terminal states unless they are asked for", async () => {
    expect((await inRange()).some((row) => row.status === "cancelled")).toBe(false);
    expect(
      (await inRange({ statuses: ["cancelled"] })).some((row) => row.status === "cancelled"),
    ).toBe(true);
  });

  it("filters by client through the embedded project", async () => {
    const rows = await inRange({ clientId: clientB });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.project.id).toBe(projectHigh);
  });

  it("filters by PM and by priority", async () => {
    expect((await inRange({ pmId: otherPm.id })).every((r) => r.project.id === projectHigh)).toBe(true);
    expect((await inRange({ priority: "high" })).every((r) => r.project.priority === "high")).toBe(true);
  });

  it("combines filters instead of replacing them", async () => {
    // Client B holds only the high-priority project, so asking for it as
    // `normal` has to come back empty rather than falling back to one filter.
    expect(await inRange({ clientId: clientB, priority: "normal" })).toHaveLength(0);
  });

  it("counts only the selected developer when filtering by one", async () => {
    expect(await countConsideredDevs(client, { ...noFilters, devId: devA.id })).toBe(1);
    expect(await countConsideredDevs(client, noFilters)).toBeGreaterThanOrEqual(2);
  });

  /**
   * Las opciones de los filtros salen de las reservas del rango, no de los
   * datos maestros: cada opción que se ofrece devuelve resultados.
   */
  it("builds the filter facets from the bookings in range", async () => {
    const rows = (
      await getFilterFacets(client, { range: DAY, filters: noFilters })
    ).filter((row) => [projectNormal, projectHigh].includes(row.projectId));

    const facets = deriveFacets(rows, noFilters);

    expect(facets.clients.map((c) => c.id).sort()).toEqual([clientA, clientB].sort());
    expect(facets.devs.map((d) => d.id).sort()).toEqual([devA.id, devB.id].sort());
    expect(facets.devs.every((d) => d.name.length > 0)).toBe(true);

    // Filtrar por el cliente B deja solo lo que ese cliente tiene en el rango.
    const narrowed = deriveFacets(rows, { ...noFilters, clientId: clientB });
    expect(narrowed.projects.map((p) => p.id)).toEqual([projectHigh]);
    expect(narrowed.devs.map((d) => d.id)).toEqual([devB.id]);
    // Y clientes sigue ofreciendo los dos: ignora su propio filtro.
    expect(narrowed.clients).toHaveLength(2);
  });

  it("keeps the facets consistent with the status filter", async () => {
    // La reserva cancelada es la única de devA sobre el proyecto común a las 14h;
    // con el filtro por defecto no debería aportar opciones.
    const withDefaults = await getFilterFacets(client, { range: DAY, filters: noFilters });
    const withCancelled = await getFilterFacets(client, {
      range: DAY,
      filters: { ...noFilters, statuses: ["cancelled"] },
    });

    const mine = (rows: typeof withDefaults) =>
      rows.filter((row) => [projectNormal, projectHigh].includes(row.projectId));

    expect(mine(withDefaults).length).toBeGreaterThan(mine(withCancelled).length);
    expect(mine(withCancelled).every((row) => row.projectId === projectNormal)).toBe(true);
  });

  it("returns spans and capacity for the aggregated views", async () => {
    const load = await getDayLoad(client, { range: DAY, filters: { ...noFilters, clientId: clientB } });

    expect(load.spans).toHaveLength(1);
    expect(load.spans[0]!.devId).toBe(devB.id);
    expect(load.devCount).toBeGreaterThanOrEqual(2);
  });
});
