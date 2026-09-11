import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { computeDevDayLoad, isOverloaded, overloadContributions } from "@/lib/calendar/planning";
import { getBookingsInRange, getDevDayLoad } from "@/lib/calendar/query";
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
import { testEmail } from "../run-id";

const password = "Test-password-123!";
const AR = "America/Argentina/Buenos_Aires";

const noFilters: CalendarFilters = {
  clientId: null,
  projectId: null,
  devId: null,
  pmId: null,
  statuses: [...DEFAULT_STATUSES],
  priority: null,
  // El default de `014`: los PM puros no se muestran. El dev de este fixture es
  // `developer` puro, así que la exclusión no lo toca — pero la consulta tiene
  // que ejercitarse como se usa en producción.
  includePms: false,
};

/** 2026-08-05, local Buenos Aires time (UTC-3), as a UTC instant. */
const at = (hour: number) =>
  new Date(Date.parse("2026-08-05T03:00:00Z") + hour * 3_600_000).toISOString();

const DAY = { from: at(0), to: at(24) };
const DAYS = ["2026-08-05"];
const KEY = (devId: string) => `${devId}::2026-08-05`;

/**
 * The unfiltered dev-day query behind the overload mark (`011/plan.md` §5).
 *
 * What is worth checking against a real database is exactly what a mock cannot
 * tell you: that RLS lets every role read the bookings of a project they do not
 * manage. If it did not, the overload total would silently shrink to "the
 * projects I can see" — the precise failure this query exists to prevent, and
 * it would show up as an under-count, never as an error.
 */
describe("planning dev-day load", () => {
  let pm: { id: string; email: string };
  let otherPm: { id: string; email: string };
  let admin: { id: string; email: string };
  let dev: { id: string; email: string };
  let clientA: string;
  let clientB: string;
  let ownProject: string;
  let foreignProject: string;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const pmUser = await createUserWithRole(testEmail(`pl-pm-${suffix}`), password, "pm");
    const otherPmUser = await createUserWithRole(testEmail(`pl-pm2-${suffix}`), password, "pm");
    const adminUser = await createUserWithRole(testEmail(`pl-admin-${suffix}`), password, "admin");
    const devUser = await createUserWithRole(testEmail(`pl-dev-${suffix}`), password, "developer");

    pm = { id: pmUser.id, email: pmUser.email! };
    otherPm = { id: otherPmUser.id, email: otherPmUser.email! };
    admin = { id: adminUser.id, email: adminUser.email! };
    dev = { id: devUser.id, email: devUser.email! };

    clientA = (await createClientRow(`PL cliente A ${suffix}`)).id;
    clientB = (await createClientRow(`PL cliente B ${suffix}`)).id;

    ownProject = (
      await createProjectRow({ name: `PL propio ${suffix}`, clientId: clientA, pmId: pm.id })
    ).id;
    foreignProject = (
      await createProjectRow({ name: `PL ajeno ${suffix}`, clientId: clientB, pmId: otherPm.id })
    ).id;

    // The same developer, six hours on each project: neither is an overload on
    // its own, together they are twelve. That shape is the whole point of the
    // second query — the hours that overload someone live in a project a filter
    // can hide.
    await createBookingRows([
      { projectId: ownProject, devId: dev.id, startsAt: at(9), endsAt: at(15) },
      {
        projectId: foreignProject,
        devId: dev.id,
        startsAt: at(15),
        endsAt: at(21),
        status: "pending",
      },
      // Cancelled: committed to nobody, so it must not add hours.
      {
        projectId: ownProject,
        devId: dev.id,
        startsAt: at(21),
        endsAt: at(23),
        status: "cancelled",
      },
    ]);
  });

  afterAll(async () => {
    try {
      await cleanupBookings([ownProject, foreignProject]);
      await cleanupProject(ownProject);
      await cleanupProject(foreignProject);
      await cleanupClient(clientA);
      await cleanupClient(clientB);
    } finally {
      await deleteTestUser(pm.id);
      await deleteTestUser(otherPm.id);
      await deleteTestUser(admin.id);
      await deleteTestUser(dev.id);
    }
  });

  /** Other tests and the seed share the database, so scope to this fixture. */
  async function rowsFor(client: SupabaseClient<Database>) {
    const rows = await getDevDayLoad(client, DAY, { includePms: false });
    return rows.filter((row) => [ownProject, foreignProject].includes(row.projectId));
  }

  it("counts a project the viewer does not manage — for a PM, an admin and a developer", async () => {
    for (const account of [pm, admin, dev]) {
      const client = await signInClient(account.email, password);
      const load = computeDevDayLoad(await rowsFor(client), DAYS, AR);

      // 6 h + 6 h. Reading the rows back rather than checking an error code:
      // RLS filters in silence, so "no error" proves nothing (ADR 0010).
      expect(load.get(KEY(dev.id)), `sesión de ${account.email}`).toBe(12);
      expect(isOverloaded(load.get(KEY(dev.id)))).toBe(true);
    }
  });

  it("names both projects and splits approved from pending", async () => {
    const client = await signInClient(pm.email, password);
    const contributions = overloadContributions(dev.id, "2026-08-05", await rowsFor(client), AR);

    expect(contributions).toHaveLength(2);
    const own = contributions.find((entry) => entry.projectId === ownProject)!;
    const foreign = contributions.find((entry) => entry.projectId === foreignProject)!;

    expect(own.projectName).toMatch(/PL propio/);
    expect(own.hoursApproved).toBe(6);
    expect(foreign.projectName).toMatch(/PL ajeno/);
    expect(foreign.hoursPending).toBe(6);
  });

  it("counts only what is committed: approved and pending, never cancelled", async () => {
    const client = await signInClient(pm.email, password);
    const rows = await rowsFor(client);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => ["approved", "pending"].includes(row.status))).toBe(true);
  });

  it("agrees with the grid query when no filter is applied", async () => {
    const client = await signInClient(pm.email, password);

    const committed = (await getBookingsInRange(client, { range: DAY, filters: noFilters }))
      .filter((row) => [ownProject, foreignProject].includes(row.project.id))
      .filter((row) => row.status === "approved" || row.status === "pending");

    const gridHours = committed.reduce(
      (total, row) => total + (Date.parse(row.endsAt) - Date.parse(row.startsAt)) / 3_600_000,
      0,
    );
    const loadHours = [...computeDevDayLoad(await rowsFor(client), DAYS, AR).values()].reduce(
      (total, hours) => total + hours,
      0,
    );

    expect(loadHours).toBe(gridHours);
  });

  it("ignores the entity filters the grid obeys — that is the feature", async () => {
    const client = await signInClient(pm.email, password);

    // The PM narrows the grid to their own client…
    const filtered = (
      await getBookingsInRange(client, {
        range: DAY,
        filters: { ...noFilters, clientId: clientA },
      })
    ).filter((row) => [ownProject, foreignProject].includes(row.project.id));
    expect(filtered.every((row) => row.project.id === ownProject)).toBe(true);

    // …and the developer still reads as overloaded, because the hours that
    // overload them live in the project the filter just hid — which the
    // contributions still name.
    const rows = await rowsFor(client);
    expect(isOverloaded(computeDevDayLoad(rows, DAYS, AR).get(KEY(dev.id)))).toBe(true);
    expect(
      overloadContributions(dev.id, "2026-08-05", rows, AR).some(
        (entry) => entry.projectId === foreignProject,
      ),
    ).toBe(true);
  });
});
