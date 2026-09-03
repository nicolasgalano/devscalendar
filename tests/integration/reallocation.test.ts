import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminClient,
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

/**
 * Una franja propia por test.
 *
 * No es prolijidad: en `005` T3.2 dos casos compartieron horario y uno pasaba
 * sin probar nada, porque la fila que miraba la había dejado el otro. Un día
 * entero de separación deja el error imposible.
 */
function slot(dayOffset: number) {
  const base = Date.parse("2026-11-16T12:00:00.000Z") + dayOffset * 86_400_000;
  return {
    startsAt: new Date(base).toISOString(),
    endsAt: new Date(base + 4 * 3_600_000).toISOString(),
  };
}

/**
 * Siembra una reserva y devuelve la fila, no un array de una.
 *
 * El `throw` no es defensivo de más: si el insert de fixture fallara en
 * silencio, el test seguiría contra una franja vacía y pasaría sin probar nada
 * —la otra mitad de la lección de `005` T3.2—.
 */
async function seedBooking(row: Parameters<typeof createBookingRows>[0][number]) {
  const [created] = await createBookingRows([row]);
  if (!created) throw new Error("no se creó la reserva de fixture");
  return created;
}

/**
 * `reallocate_booking()` — lo que `006` no puede salir sin probar (R-1).
 *
 * **Todas las aserciones leen las filas de vuelta.** Un test que solo mirara el
 * error pasaría con la RLS filtrando en silencio, que es exactamente el modo de
 * falla de `plan.md` §3.2: un `update` que la policy descarta no falla, afecta
 * cero filas, y el resultado serían dos reservas aprobadas superpuestas sin un
 * solo mensaje. Mirar el código de error no distingue esos dos mundos; leer el
 * estado de la fila sí.
 */
describe("reallocate_booking", () => {
  let pmHigh: { id: string; email: string };
  let pmOtherHigh: { id: string; email: string };
  let pmCommon: { id: string; email: string };
  let dev: { id: string; email: string };
  let clientId: string;
  let highProject: string;
  let otherHighProject: string;
  let commonProject: string;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);

    const high = await createUserWithRole(testEmail(`re-pm-high-${suffix}`), password, "pm");
    const otherHigh = await createUserWithRole(testEmail(`re-pm-high2-${suffix}`), password, "pm");
    const common = await createUserWithRole(testEmail(`re-pm-common-${suffix}`), password, "pm");
    const developer = await createUserWithRole(
      testEmail(`re-dev-${suffix}`),
      password,
      "developer",
    );

    pmHigh = { id: high.id, email: high.email! };
    pmOtherHigh = { id: otherHigh.id, email: otherHigh.email! };
    pmCommon = { id: common.id, email: common.email! };
    dev = { id: developer.id, email: developer.email! };

    clientId = (await createClientRow(`RE cliente ${suffix}`)).id;

    highProject = (
      await createProjectRow({
        name: `RE prioritario ${suffix}`,
        clientId,
        pmId: pmHigh.id,
        priority: "high",
      })
    ).id;
    otherHighProject = (
      await createProjectRow({
        name: `RE prioritario B ${suffix}`,
        clientId,
        pmId: pmOtherHigh.id,
        priority: "high",
      })
    ).id;
    commonProject = (
      await createProjectRow({
        name: `RE común ${suffix}`,
        clientId,
        pmId: pmCommon.id,
        priority: "normal",
      })
    ).id;
  });

  afterAll(async () => {
    try {
      await cleanupBookings([highProject, otherHighProject, commonProject]);
      await cleanupProject(highProject);
      await cleanupProject(otherHighProject);
      await cleanupProject(commonProject);
      await cleanupClient(clientId);
    } finally {
      await deleteTestUser(pmHigh.id);
      await deleteTestUser(pmOtherHigh.id);
      await deleteTestUser(pmCommon.id);
      await deleteTestUser(dev.id);
    }
  });

  /** Estado actual de una reserva, leído con service_role para saltear la RLS. */
  async function statusOf(bookingId: string): Promise<string> {
    const { data, error } = await adminClient()
      .from("bookings")
      .select("status")
      .eq("id", bookingId)
      .single();
    if (error) throw error;
    return data.status;
  }

  /** Reservas del dev que tocan una franja, sin importar el estado. */
  async function bookingsIn({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
    const { data, error } = await adminClient()
      .from("bookings")
      .select("id, status, project_id")
      .eq("dev_id", dev.id)
      .lt("starts_at", endsAt)
      .gt("ends_at", startsAt);
    if (error) throw error;
    return data;
  }

  // ── T3.2: la matriz, contra la base ────────────────────────────────────────

  it("lets a priority project displace an approved common booking", async () => {
    const { startsAt, endsAt } = slot(0);
    const existing = await seedBooking({
      projectId: commonProject,
      devId: dev.id,
      startsAt,
      endsAt,
      status: "approved",
    });

    const client = await signInClient(pmHigh.email, password);
    const { data, error } = await client.rpc("reallocate_booking", {
      target_project: highProject,
      target_dev: dev.id,
      starts: startsAt,
      ends: endsAt,
      confirmed_displacing: [existing.id],
    });

    expect(error).toBeNull();

    // La respuesta dice una cosa; la base es la que manda. Se verifican las dos.
    const result = data as unknown as {
      booking: { id: string; status: string };
      displaced: { id: string }[];
    };
    expect(result.displaced.map((row) => row.id)).toEqual([existing.id]);

    expect(await statusOf(existing.id)).toBe("displaced");
    expect(await statusOf(result.booking.id)).toBe("pending");
  });

  it("refuses to let a common project displace a priority booking", async () => {
    const { startsAt, endsAt } = slot(1);
    const existing = await seedBooking({
      projectId: highProject,
      devId: dev.id,
      startsAt,
      endsAt,
      status: "approved",
    });

    const client = await signInClient(pmCommon.email, password);
    const { error } = await client.rpc("reallocate_booking", {
      target_project: commonProject,
      target_dev: dev.id,
      starts: startsAt,
      ends: endsAt,
      confirmed_displacing: [existing.id],
    });

    expect(error?.code).toBe("DC001");
    // Lo que de verdad se está probando: que no pasó nada.
    expect(await statusOf(existing.id)).toBe("approved");
    expect(await bookingsIn(slot(1))).toHaveLength(1);
  });

  it("refuses a tie between two priority projects", async () => {
    const { startsAt, endsAt } = slot(2);
    const existing = await seedBooking({
      projectId: otherHighProject,
      devId: dev.id,
      startsAt,
      endsAt,
      status: "approved",
    });

    const client = await signInClient(pmHigh.email, password);
    const { error } = await client.rpc("reallocate_booking", {
      target_project: highProject,
      target_dev: dev.id,
      starts: startsAt,
      ends: endsAt,
      confirmed_displacing: [existing.id],
    });

    // AC-1.3: no hay override automático, y el error **no es el mismo** que el
    // de prioridad insuficiente. Si los dos fueran DC001, el PM no sabría si
    // buscar otra franja o levantar el teléfono.
    expect(error?.code).toBe("DC002");
    expect(await statusOf(existing.id)).toBe("approved");
    expect(await bookingsIn(slot(2))).toHaveLength(1);
  });

  it("does not displace a common booking that is still pending", async () => {
    const { startsAt, endsAt } = slot(3);
    const existing = await seedBooking({
      projectId: commonProject,
      devId: dev.id,
      startsAt,
      endsAt,
      status: "pending",
    });

    const client = await signInClient(pmHigh.email, password);
    const { error } = await client.rpc("reallocate_booking", {
      target_project: highProject,
      target_dev: dev.id,
      starts: startsAt,
      ends: endsAt,
      confirmed_displacing: [existing.id],
    });

    // Parece el caso obvio y no lo es: una reserva que nadie aprobó **no ocupa
    // nada** —el exclusion constraint ni la mira (004 AC-4.2)— así que no hay
    // qué desplazar, y el camino correcto es el alta normal.
    expect(error?.code).toBe("DC003");
    expect(await statusOf(existing.id)).toBe("pending");
    expect(await bookingsIn(slot(3))).toHaveLength(1);
  });

  it("refuses when the slot holds something the PM did not confirm", async () => {
    const { startsAt, endsAt } = slot(4);
    const existing = await seedBooking({
      projectId: commonProject,
      devId: dev.id,
      startsAt,
      endsAt,
      status: "approved",
    });

    const client = await signInClient(pmHigh.email, password);
    const { error } = await client.rpc("reallocate_booking", {
      target_project: highProject,
      target_dev: dev.id,
      starts: startsAt,
      ends: endsAt,
      // Un id cualquiera: lo que el PM confirmó no es lo que hay.
      confirmed_displacing: [randomUUID()],
    });

    expect(error?.code).toBe("DC003");
    expect(await statusOf(existing.id)).toBe("approved");
  });

  // ── T3.3: atomicidad ───────────────────────────────────────────────────────

  it("leaves nothing behind when the second step fails", async () => {
    const { startsAt, endsAt } = slot(5);
    const existing = await seedBooking({
      projectId: commonProject,
      devId: dev.id,
      startsAt,
      endsAt,
      status: "approved",
    });

    // Una franja de duración cero adentro de la reserva existente. Se superpone
    // —`starts_at < ends` y `ends_at > starts` se cumplen las dos— así que la
    // función llega hasta el update y desplaza; el `insert` posterior es el que
    // revienta contra `bookings_ends_after_starts`. Es la única forma de hacer
    // fallar el segundo paso habiendo pasado el primero, y sin eso nada prueba
    // que la función sea atómica y no dos escrituras seguidas con suerte.
    const instant = new Date(Date.parse(startsAt) + 3_600_000).toISOString();

    const client = await signInClient(pmHigh.email, password);
    const { error } = await client.rpc("reallocate_booking", {
      target_project: highProject,
      target_dev: dev.id,
      starts: instant,
      ends: instant,
      confirmed_displacing: [existing.id],
    });

    expect(error).not.toBeNull();
    // El primer paso tampoco quedó.
    expect(await statusOf(existing.id)).toBe("approved");

    // Y no quedó rastro en la auditoría: el trigger de 005 escribe adentro de la
    // misma transacción, así que si la fila sobrevivió es que no hubo rollback.
    const { data: trail } = await adminClient()
      .from("audit_log")
      .select("id")
      .eq("entity_id", existing.id);
    expect(trail ?? []).toHaveLength(0);
  });

  // ── T3.4: auditoría ────────────────────────────────────────────────────────

  it("records both the state change and the decision", async () => {
    const { startsAt, endsAt } = slot(6);
    const existing = await seedBooking({
      projectId: commonProject,
      devId: dev.id,
      startsAt,
      endsAt,
      status: "approved",
    });

    const client = await signInClient(pmHigh.email, password);
    const { data, error } = await client.rpc("reallocate_booking", {
      target_project: highProject,
      target_dev: dev.id,
      starts: startsAt,
      ends: endsAt,
      confirmed_displacing: [existing.id],
    });
    expect(error).toBeNull();
    const result = data as unknown as { booking: { id: string } };

    const { data: trail } = await adminClient()
      .from("audit_log")
      .select("action, actor_id, diff")
      .eq("entity_id", existing.id);

    // Dos filas por el mismo evento, a propósito (plan.md §3.4): una cuenta el
    // cambio de estado y la otra la decisión. Con una sola no se puede saber
    // *qué* desplazó a esta reserva, que es lo único que el PM desplazado
    // necesita para entender qué le pasó.
    const actions = (trail ?? []).map((row) => row.action).sort();
    expect(actions).toEqual(["reallocated", "status_change"]);

    const decision = (trail ?? []).find((row) => row.action === "reallocated");
    expect(decision?.actor_id).toBe(pmHigh.id);
    expect(decision?.diff).toMatchObject({
      displaced_by: result.booking.id,
      project: highProject,
    });

    const change = (trail ?? []).find((row) => row.action === "status_change");
    expect(change?.diff).toMatchObject({ from: "approved", to: "displaced" });
  });

  // ── T3.5: concurrencia (R-4) ───────────────────────────────────────────────

  it("serialises two priority reallocations racing for the same slot", async () => {
    const { startsAt, endsAt } = slot(7);
    const existing = await seedBooking({
      projectId: commonProject,
      devId: dev.id,
      startsAt,
      endsAt,
      status: "approved",
    });

    const [first, second] = await Promise.all([
      signInClient(pmHigh.email, password),
      signInClient(pmOtherHigh.email, password),
    ]);

    // **En paralelo, no en serie.** En serie el test pasaría aunque no hubiera
    // ningún lock: la gracia es que las dos lean "acá solo hay una común" antes
    // de que ninguna escriba.
    const results = await Promise.all([
      first.rpc("reallocate_booking", {
        target_project: highProject,
        target_dev: dev.id,
        starts: startsAt,
        ends: endsAt,
        confirmed_displacing: [existing.id],
      }),
      second.rpc("reallocate_booking", {
        target_project: otherHighProject,
        target_dev: dev.id,
        starts: startsAt,
        ends: endsAt,
        confirmed_displacing: [existing.id],
      }),
    ]);

    const winners = results.filter((result) => result.error === null);
    expect(winners).toHaveLength(1);

    // La perdedora se entera de que la franja cambió, no la desplaza de nuevo.
    const loser = results.find((result) => result.error !== null);
    expect(loser?.error?.code).toBe("DC003");

    // Y lo que importa de verdad: una sola reserva nueva, no dos.
    const inSlot = await bookingsIn(slot(7));
    expect(inSlot.filter((row) => row.status === "pending")).toHaveLength(1);
    expect(inSlot.filter((row) => row.status === "displaced")).toHaveLength(1);
  });

  // ── T3.6: el guard de la función definer ───────────────────────────────────

  it("refuses a caller who does not manage the new project", async () => {
    const { startsAt, endsAt } = slot(8);
    const existing = await seedBooking({
      projectId: commonProject,
      devId: dev.id,
      startsAt,
      endsAt,
      status: "approved",
    });

    // El PM del proyecto común pidiendo reservar en nombre del prioritario, que
    // no es suyo. Sin el chequeo 1, `security definer` sería una puerta abierta
    // a crear reservas en cualquier proyecto.
    const client = await signInClient(pmCommon.email, password);
    const { error } = await client.rpc("reallocate_booking", {
      target_project: highProject,
      target_dev: dev.id,
      starts: startsAt,
      ends: endsAt,
      confirmed_displacing: [existing.id],
    });

    expect(error?.code).toBe("42501");
    expect(await statusOf(existing.id)).toBe("approved");
    expect(await bookingsIn(slot(8))).toHaveLength(1);
  });
});
