import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { findConflictingBooking } from "@/lib/bookings/conflicts";
import { getBookingFormOptions } from "@/lib/bookings/options";
import {
  countConsideredDevs,
  getBookingsInRange,
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
} from "../integration/helpers";
import { testEmail } from "../run-id";

/**
 * Suite smoke: lo que **solo PostgREST** puede confirmar.
 *
 * Los tests unitarios de `tests/unit/query-layer.test.ts` ya cubren el mapeo y
 * los filtros con el cliente mockeado. Lo que un mock no puede ver es si el
 * string de un embed es válido: `dev:profiles!bookings_dev_id_fkey (...)` se
 * resuelve **en el servidor**, y un nombre de constraint equivocado o un
 * `!inner` mal puesto pasan cualquier test mockeado y explotan en runtime.
 *
 * Por eso esto corre contra el stack efímero de CI, que sí trae PostgREST y
 * GoTrue. Es chica a propósito: no re-testea la lógica, testea el contrato con
 * el servidor.
 */

const password = "Test-password-123!";

const noFilters: CalendarFilters = {
  clientId: null,
  projectId: null,
  devId: null,
  pmId: null,
  statuses: [...DEFAULT_STATUSES],
  priority: null,
};

/** 2026-09-08, hora de Buenos Aires (UTC-3), como instante UTC. */
const at = (hour: number) =>
  new Date(Date.parse("2026-09-08T03:00:00Z") + hour * 3_600_000).toISOString();

const DAY = { from: at(0), to: at(24) };

describe("contrato con PostgREST y GoTrue", () => {
  let pm: { id: string; email: string };
  let dev: { id: string };
  let clientA: string;
  let clientB: string;
  let projectA: string;
  let projectB: string;
  let client: SupabaseClient<Database>;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const pmUser = await createUserWithRole(testEmail(`smoke-pm-${suffix}`), password, "pm");
    const devUser = await createUserWithRole(
      testEmail(`smoke-dev-${suffix}`),
      password,
      "developer",
    );
    pm = { id: pmUser.id, email: pmUser.email! };
    dev = { id: devUser.id };

    clientA = (await createClientRow(`Smoke cliente A ${suffix}`)).id;
    clientB = (await createClientRow(`Smoke cliente B ${suffix}`)).id;
    projectA = (
      await createProjectRow({ name: `Smoke A ${suffix}`, clientId: clientA, pmId: pm.id })
    ).id;
    projectB = (
      await createProjectRow({ name: `Smoke B ${suffix}`, clientId: clientB, pmId: pm.id })
    ).id;

    await createBookingRows([
      { projectId: projectA, devId: dev.id, startsAt: at(9), endsAt: at(13) },
      { projectId: projectB, devId: dev.id, startsAt: at(14), endsAt: at(17) },
    ]);

    // GoTrue de verdad: contraseña → sesión → JWT que la RLS usa para decidir.
    // Si el stack efímero levantara sin auth, esto falla acá y no en un test
    // suelto quince minutos después.
    client = await signInClient(pm.email, password);
  });

  afterAll(async () => {
    try {
      await cleanupBookings([projectA, projectB]);
      await cleanupProject(projectA);
      await cleanupProject(projectB);
      await cleanupClient(clientA);
      await cleanupClient(clientB);
    } finally {
      await deleteTestUser(pm.id);
      await deleteTestUser(dev.id);
    }
  });

  /**
   * `bookings` apunta dos veces a `profiles` (`dev_id` y `created_by`), así que
   * PostgREST no puede adivinar la relación: hace falta el nombre del
   * constraint. Si ese nombre cambia en una migration, esto es lo que avisa.
   */
  it("resuelve el embed de desarrollador desambiguado por constraint", async () => {
    const rows = await getBookingsInRange(client, { range: DAY, filters: noFilters });
    const mine = rows.filter((row) => row.project.id === projectA);

    expect(mine).toHaveLength(1);
    expect(mine[0]!.dev.id).toBe(dev.id);
    expect(mine[0]!.dev.name).toBeTruthy();
  });

  /** Embed anidado de dos niveles: booking → project → client. */
  it("trae el cliente a través del proyecto", async () => {
    const rows = await getBookingsInRange(client, { range: DAY, filters: noFilters });
    const found = rows.find((row) => row.project.id === projectA);

    expect(found!.project.client.id).toBe(clientA);
    expect(found!.project.client.name).toContain("Smoke cliente A");
  });

  /**
   * El filtro por cliente vive en `projects`, no en `bookings`: se aplica sobre
   * una columna embebida. Con un embed que no fuera `!inner`, las filas que no
   * matchean volverían con el embed en null en vez de desaparecer — o sea, el
   * filtro no filtraría.
   */
  it("filtra por una columna embebida y descarta las filas que no matchean", async () => {
    const rows = await getBookingsInRange(client, {
      range: DAY,
      filters: { ...noFilters, clientId: clientA },
    });

    expect(rows.map((row) => row.project.id)).toContain(projectA);
    expect(rows.map((row) => row.project.id)).not.toContain(projectB);
  });

  /** Las facetas embeben proyecto, cliente y PM en una sola query. */
  it("arma las facetas con proyecto, cliente y PM embebidos", async () => {
    const rows = await getFilterFacets(client, { range: DAY, filters: noFilters });
    const found = rows.find((row) => row.projectId === projectA);

    expect(found).toMatchObject({ clientId: clientA, pmId: pm.id });
    expect(found!.pmName).toBeTruthy();
    expect(found!.devName).toBeTruthy();
  });

  /** `head: true` + `count: exact`: la respuesta no trae filas, solo el total. */
  it("cuenta desarrolladores sin traer filas", async () => {
    const total = await countConsideredDevs(client, noFilters);
    expect(total).toBeGreaterThanOrEqual(1);

    expect(await countConsideredDevs(client, { ...noFilters, devId: dev.id })).toBe(1);
  });

  it("encuentra la reserva aprobada que bloquea una franja", async () => {
    const conflict = await findConflictingBooking(client, {
      devId: dev.id,
      startsAt: at(10),
      endsAt: at(12),
    });

    expect(conflict).not.toBeNull();
    expect(conflict!.projectName).toContain("Smoke A");
    expect(conflict!.devName).toBeTruthy();
  });

  /** El embed `client:clients!inner (name)` del formulario de reservas. */
  it("trae las opciones del formulario con el nombre del cliente", async () => {
    const options = await getBookingFormOptions(client, { id: pm.id, role: "pm" });
    const found = options.projects.find((project) => project.id === projectA);

    expect(found!.clientName).toContain("Smoke cliente A");
    expect(options.devs.some((candidate) => candidate.id === dev.id)).toBe(true);
  });
});
