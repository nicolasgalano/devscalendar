import { describe, expect, it } from "vitest";

import { findConflictingBooking } from "@/lib/bookings/conflicts";
import { getBookingFormOptions } from "@/lib/bookings/options";
import { getBookingsInRange } from "@/lib/calendar/query";
import { DEFAULT_STATUSES, type CalendarFilters } from "@/lib/validation/calendar";

import { createSupabaseMock } from "./helpers/supabase-mock";

/**
 * La capa de queries **sin base de datos**: mapeo de la respuesta, qué filtros
 * se aplican y qué pasa cuando Supabase devuelve error.
 *
 * Lo que estos tests no pueden ver es si los embeds son sintaxis válida de
 * PostgREST — eso lo cubre `tests/smoke/` contra el stack efímero. La división
 * está explicada en `docs/testing.md`.
 */

const RANGE = { from: "2026-08-10T03:00:00.000Z", to: "2026-08-11T03:00:00.000Z" };

const noFilters: CalendarFilters = {
  clientId: null,
  projectId: null,
  devId: null,
  pmId: null,
  statuses: [...DEFAULT_STATUSES],
  priority: null,
};

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    starts_at: "2026-08-10T12:00:00.000Z",
    ends_at: "2026-08-10T16:00:00.000Z",
    status: "pending",
    note: "Migrar el checkout",
    ticket_ref: "DEV-1",
    dev: { id: "d1", full_name: "Malena Ruiz", email: "malena@example.com" },
    project: {
      id: "p1",
      name: "Portal de reservas",
      priority: "high",
      pm_id: "pm1",
      client: { id: "c1", name: "Nimbus SRL" },
    },
    ...overrides,
  };
}

describe("getBookingsInRange", () => {
  it("maps the row into the calendar shape", async () => {
    const mock = createSupabaseMock({ bookings: { data: [bookingRow()] } });

    const [booking] = await getBookingsInRange(mock.client, {
      range: RANGE,
      filters: noFilters,
    });

    expect(booking).toEqual({
      id: "b1",
      startsAt: "2026-08-10T12:00:00.000Z",
      endsAt: "2026-08-10T16:00:00.000Z",
      status: "pending",
      note: "Migrar el checkout",
      ticketRef: "DEV-1",
      dev: { id: "d1", name: "Malena Ruiz" },
      project: {
        id: "p1",
        name: "Portal de reservas",
        priority: "high",
        pmId: "pm1",
        client: { id: "c1", name: "Nimbus SRL" },
      },
    });
  });

  /**
   * Alguien que entró con Google y todavía no tiene nombre para mostrar sigue
   * siendo legible en la grilla. Sin el fallback el bloque quedaría en blanco,
   * que es peor que mostrar un email.
   */
  it("falls back to the email when the developer has no display name", async () => {
    const mock = createSupabaseMock({
      bookings: {
        data: [
          bookingRow({
            dev: { id: "d1", full_name: null, email: "sin-nombre@example.com" },
          }),
        ],
      },
    });

    const [booking] = await getBookingsInRange(mock.client, {
      range: RANGE,
      filters: noFilters,
    });

    expect(booking!.dev.name).toBe("sin-nombre@example.com");
  });

  /**
   * El solapamiento es `starts_at < to and ends_at > from`, no un `between`: una
   * reserva que empieza antes del rango visible pero entra en él tiene que
   * aparecer igual. Equivocarse acá esconde trabajo en los bordes de la vista, y
   * es la clase de bug que nadie reporta porque el bloque simplemente no está.
   */
  it("filters by overlap, not by containment", async () => {
    const mock = createSupabaseMock({ bookings: { data: [] } });

    await getBookingsInRange(mock.client, { range: RANGE, filters: noFilters });

    const query = mock.lastQuery("bookings");
    expect(query.filters.lt).toContainEqual(["starts_at", RANGE.to]);
    expect(query.filters.gt).toContainEqual(["ends_at", RANGE.from]);
    expect(query.filters.in).toContainEqual(["status", DEFAULT_STATUSES]);
  });

  it("applies only the filters that are set", async () => {
    const mock = createSupabaseMock({ bookings: { data: [] } });

    await getBookingsInRange(mock.client, {
      range: RANGE,
      filters: { ...noFilters, devId: "d9", clientId: "c9", priority: "high" },
    });

    const { eq } = mock.lastQuery("bookings").filters;
    expect(eq).toContainEqual(["dev_id", "d9"]);
    // Cliente, PM y prioridad viven en `projects`, así que se filtran a través
    // del embed.
    expect(eq).toContainEqual(["project.client_id", "c9"]);
    expect(eq).toContainEqual(["project.priority", "high"]);
    expect(eq.map(([column]) => column)).not.toContain("project_id");
    expect(eq.map(([column]) => column)).not.toContain("project.pm_id");
  });

  it("throws when Supabase returns an error", async () => {
    const mock = createSupabaseMock({
      bookings: { error: { message: "permission denied for table bookings" } },
    });

    await expect(
      getBookingsInRange(mock.client, { range: RANGE, filters: noFilters }),
    ).rejects.toMatchObject({ message: "permission denied for table bookings" });
  });
});

describe("findConflictingBooking", () => {
  const slot = {
    devId: "d1",
    startsAt: "2026-08-10T12:00:00.000Z",
    endsAt: "2026-08-10T16:00:00.000Z",
  };

  it("returns null when nothing overlaps", async () => {
    const mock = createSupabaseMock({ bookings: { data: null } });

    expect(await findConflictingBooking(mock.client, slot)).toBeNull();
  });

  it("only looks at approved bookings of that developer", async () => {
    const mock = createSupabaseMock({ bookings: { data: null } });

    await findConflictingBooking(mock.client, slot);

    const { eq, lt, gt } = mock.lastQuery("bookings").filters;
    expect(eq).toContainEqual(["dev_id", "d1"]);
    expect(eq).toContainEqual(["status", "approved"]);
    // Espeja la condición del constraint, incluido el borde `[)`.
    expect(lt).toContainEqual(["starts_at", slot.endsAt]);
    expect(gt).toContainEqual(["ends_at", slot.startsAt]);
  });

  it("excludes the booking being edited, and only then", async () => {
    const withExclusion = createSupabaseMock({ bookings: { data: null } });
    await findConflictingBooking(withExclusion.client, { ...slot, excludeId: "b1" });
    expect(withExclusion.lastQuery("bookings").filters.neq).toContainEqual(["id", "b1"]);

    const without = createSupabaseMock({ bookings: { data: null } });
    await findConflictingBooking(without.client, slot);
    expect(without.lastQuery("bookings").filters.neq).toHaveLength(0);
  });

  it("names the developer and the project that block the slot", async () => {
    const mock = createSupabaseMock({
      bookings: {
        data: {
          id: "b9",
          starts_at: "2026-08-10T13:00:00.000Z",
          ends_at: "2026-08-10T17:00:00.000Z",
          dev: { full_name: null, email: "cristian@example.com" },
          project: {
            name: "Website revamp",
            priority: "normal",
            pm: { full_name: "Lucía Fernández", email: "lucia@example.com" },
          },
        },
      },
    });

    expect(await findConflictingBooking(mock.client, slot)).toEqual({
      id: "b9",
      startsAt: "2026-08-10T13:00:00.000Z",
      endsAt: "2026-08-10T17:00:00.000Z",
      projectName: "Website revamp",
      devName: "cristian@example.com",
      projectPriority: "normal",
      pmName: "Lucía Fernández",
    });
  });

  // 006 T2.2: without the priority of the project holding the slot, the UI
  // cannot tell a conflict it may displace from one it may not, and would have
  // to offer the same dead end for both.
  it("carries the priority of the project holding the slot", async () => {
    const mock = createSupabaseMock({
      bookings: {
        data: {
          id: "b9",
          starts_at: "2026-08-10T13:00:00.000Z",
          ends_at: "2026-08-10T17:00:00.000Z",
          dev: { full_name: "Cristian Soto", email: "cristian@example.com" },
          project: { name: "Portal de reservas", priority: "high", pm: null },
        },
      },
    });

    const conflict = await findConflictingBooking(mock.client, slot);

    expect(conflict?.projectPriority).toBe("high");
    // A deactivated or removed PM leaves the conflict standing, without a name.
    expect(conflict?.pmName).toBeNull();
  });
});

describe("getBookingFormOptions", () => {
  const projects = {
    data: [
      { id: "p2", name: "Website revamp", priority: "normal", client: { name: "Zeta" } },
      { id: "p1", name: "Portal de reservas", priority: "high", client: { name: "Nimbus" } },
    ],
  };
  const devs = {
    data: [
      { id: "d2", full_name: "Zoe Vera", email: "zoe@example.com" },
      { id: "d1", full_name: null, email: "ana@example.com" },
    ],
  };

  /**
   * Un desarrollador no reserva: la feature `004` es del PM y del admin. Que no
   * se dispare **ninguna** query es parte del contrato — evita dos round trips
   * por render en la vista de alguien que nunca va a ver el botón.
   */
  it("asks for nothing when the viewer cannot create bookings", async () => {
    const mock = createSupabaseMock({});

    const options = await getBookingFormOptions(mock.client, {
      id: "d1",
      role: "developer",
    });

    expect(options).toEqual({ projects: [], devs: [] });
    expect(mock.queries).toHaveLength(0);
  });

  it("asks for nothing when there is no session", async () => {
    const mock = createSupabaseMock({});
    expect(await getBookingFormOptions(mock.client, null)).toEqual({
      projects: [],
      devs: [],
    });
    expect(mock.queries).toHaveLength(0);
  });

  it("scopes a PM to their own active projects", async () => {
    const mock = createSupabaseMock({ projects, profiles: devs });

    await getBookingFormOptions(mock.client, { id: "pm1", role: "pm" });

    const { eq } = mock.lastQuery("projects").filters;
    expect(eq).toContainEqual(["pm_id", "pm1"]);
    expect(eq).toContainEqual(["active", true]);
  });

  it("does not scope an admin by PM", async () => {
    const mock = createSupabaseMock({ projects, profiles: devs });

    await getBookingFormOptions(mock.client, { id: "a1", role: "admin" });

    const { eq } = mock.lastQuery("projects").filters;
    expect(eq.map(([column]) => column)).not.toContain("pm_id");
    expect(eq).toContainEqual(["active", true]);
  });

  it("offers only active developers", async () => {
    const mock = createSupabaseMock({ projects, profiles: devs });

    await getBookingFormOptions(mock.client, { id: "a1", role: "admin" });

    const { eq } = mock.lastQuery("profiles").filters;
    expect(eq).toContainEqual(["role", "developer"]);
    expect(eq).toContainEqual(["active", true]);
  });

  it("maps and sorts both lists by name", async () => {
    const mock = createSupabaseMock({ projects, profiles: devs });

    const options = await getBookingFormOptions(mock.client, { id: "a1", role: "admin" });

    expect(options.projects).toEqual([
      { id: "p1", name: "Portal de reservas", clientName: "Nimbus", priority: "high" },
      { id: "p2", name: "Website revamp", clientName: "Zeta", priority: "normal" },
    ]);
    // El dev sin nombre entra por su email, y ordena por ese mismo valor.
    expect(options.devs).toEqual([
      { id: "d1", name: "ana@example.com" },
      { id: "d2", name: "Zoe Vera" },
    ]);
  });

  it("throws when either query fails", async () => {
    const mock = createSupabaseMock({
      projects: { error: { message: "boom" } },
      profiles: devs,
    });

    await expect(
      getBookingFormOptions(mock.client, { id: "a1", role: "admin" }),
    ).rejects.toMatchObject({ message: "boom" });
  });
});
