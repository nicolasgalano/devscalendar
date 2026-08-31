import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database";

import {
  adminClient,
  cleanupBookings,
  cleanupClient,
  cleanupProject,
  createClientRow,
  createProjectRow,
  createUserWithRole,
  deleteTestUser,
  signInClient,
} from "./helpers";
import { testEmail } from "../run-id";

const password = "Test-password-123!";
// Fecha propia del archivo: `fullyParallel` corre los archivos a la vez y cada
// uno tiene que poder aprobar sin chocar con las franjas de otro.
const at = (hour: number) =>
  new Date(Date.parse("2026-10-12T03:00:00Z") + hour * 3_600_000).toISOString();

type BookingUpdate = Database["public"]["Tables"]["bookings"]["Update"];
/** Las cuatro columnas que el guard le prohíbe tocar al desarrollador. */
type GuardedColumn = "starts_at" | "ends_at" | "note" | "ticket_ref";

/**
 * R-1, el test que no puede faltar de `005`.
 *
 * La policy del dev (`bookings: developer responds`) le da `update` sobre
 * **cualquier columna** de sus propias reservas: la RLS de Postgres no sabe
 * expresar "solo estas columnas". Lo que impide que eso sea "el dev se mueve
 * sus propias horas" es el guard dentro de `enforce_booking_status_transition()`,
 * y esto es lo único que lo verifica.
 *
 * Va contra la base directamente y no contra la API, porque la API tiene su
 * propio guard (`requireBookingResponder`) y taparia un agujero de la policy.
 */
describe("bookings developer response RLS", () => {
  let pm: { id: string; email: string };
  let dev: { id: string; email: string };
  let otherDev: { id: string; email: string };
  let adminDev: { id: string; email: string };
  let clientId: string;
  let projectId: string;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const manager = await createUserWithRole(testEmail(`rsp-pm-${suffix}`), password, "pm");
    const developer = await createUserWithRole(
      testEmail(`rsp-dev-${suffix}`),
      password,
      "developer",
    );
    const other = await createUserWithRole(testEmail(`rsp-other-${suffix}`), password, "developer");
    const administrator = await createUserWithRole(
      testEmail(`rsp-admin-${suffix}`),
      password,
      "admin",
    );

    pm = { id: manager.id, email: manager.email! };
    dev = { id: developer.id, email: developer.email! };
    otherDev = { id: other.id, email: other.email! };
    adminDev = { id: administrator.id, email: administrator.email! };

    clientId = (await createClientRow(`RSP cliente ${suffix}`)).id;
    projectId = (await createProjectRow({ name: `RSP proyecto ${suffix}`, clientId, pmId: pm.id }))
      .id;
  });

  afterAll(async () => {
    try {
      await cleanupBookings([projectId]);
      await cleanupProject(projectId);
      await cleanupClient(clientId);
    } finally {
      await deleteTestUser(pm.id);
      await deleteTestUser(dev.id);
      await deleteTestUser(otherDev.id);
      await deleteTestUser(adminDev.id);
    }
  });

  /** Una reserva pendiente recien nacida, sembrada con `service_role`. */
  async function pendingBooking(devId: string = dev.id) {
    const { data, error } = await adminClient()
      .from("bookings")
      .insert({
        project_id: projectId,
        dev_id: devId,
        created_by: pm.id,
        starts_at: at(9),
        ends_at: at(13),
        status: "pending",
        note: "Migracion del checkout",
        ticket_ref: "WEB-142",
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /** La fila como la ve `service_role`, sin RLS de por medio. */
  async function readBack(id: string) {
    const { data } = await adminClient().from("bookings").select().eq("id", id).maybeSingle();
    return data;
  }

  // Lo que el desarrollador SI puede
  // ---------------------------------------------------------------------------

  it("lets the assigned developer approve their own booking", async () => {
    const booking = await pendingBooking();
    const client = await signInClient(dev.email, password);

    const { error } = await client
      .from("bookings")
      .update({ status: "approved" })
      .eq("id", booking.id);
    expect(error).toBeNull();

    const row = await readBack(booking.id);
    expect(row?.status).toBe("approved");
    // Lo deriva el trigger: el cliente nunca lo manda.
    expect(row?.responded_at).not.toBeNull();
  });

  it("lets the assigned developer reject with a reason", async () => {
    const booking = await pendingBooking();
    const client = await signInClient(dev.email, password);

    const { error } = await client
      .from("bookings")
      .update({ status: "rejected", response_note: "Esa semana estoy con el release" })
      .eq("id", booking.id);
    expect(error).toBeNull();

    const row = await readBack(booking.id);
    expect(row?.status).toBe("rejected");
    expect(row?.response_note).toBe("Esa semana estoy con el release");
    // El pedido original del PM sigue intacto: `response_note` es una columna
    // aparte justamente para no pisarlo.
    expect(row?.note).toBe("Migracion del checkout");
  });

  // Lo que el desarrollador NO puede: el guard de columnas
  // ---------------------------------------------------------------------------

  /**
   * Se verifica de las dos formas a la vez, y no es redundante: hoy el guard
   * **tira** y el codigo del error lo prueba, pero si algun dia la regla se
   * mudara a una policy, la RLS convertiria el update en un no-op silencioso y
   * un test que solo mirara el error pasaria por la razon equivocada. Es la
   * leccion de `004` T4.2.
   */
  // El patch va entero y no como key computada: `{ [column]: value }` le borra
  // a TypeScript qué columna se está tocando, y con eso se pierde justamente la
  // verificación de que el nombre existe en la tabla.
  const guarded: { column: GuardedColumn; patch: () => BookingUpdate }[] = [
    { column: "starts_at", patch: () => ({ starts_at: at(15) }) },
    { column: "ends_at", patch: () => ({ ends_at: at(20) }) },
    { column: "note", patch: () => ({ note: "me reescribo el pedido" }) },
    { column: "ticket_ref", patch: () => ({ ticket_ref: "WEB-999" }) },
  ];

  it.each(guarded)("stops the developer from changing $column", async ({ column, patch }) => {
    const booking = await pendingBooking();
    const client = await signInClient(dev.email, password);

    const { error } = await client.from("bookings").update(patch()).eq("id", booking.id);

    expect(error?.code).toBe("23514");

    const row = await readBack(booking.id);
    expect(row?.[column]).toEqual(booking[column]);
  });

  /**
   * `dev_id` aparte de los otros cuatro: aca pueden hablar dos mecanismos -el
   * guard del trigger y el `with check` de la policy, que dejaria de matchear
   * al cambiar el dueno de la fila- y cual gane depende del orden en que
   * Postgres los evalua. Lo que el test fija es el resultado, que es lo que
   * importa: la reserva no cambia de manos.
   */
  it("stops the developer from reassigning the booking", async () => {
    const booking = await pendingBooking();
    const client = await signInClient(dev.email, password);

    const { error } = await client
      .from("bookings")
      .update({ dev_id: otherDev.id })
      .eq("id", booking.id);
    expect(error).not.toBeNull();

    const row = await readBack(booking.id);
    expect(row?.dev_id).toBe(dev.id);
  });

  /**
   * Aca no hay error que mirar: el `using` de la policy filtra la fila antes de
   * que haya algo que actualizar, asi que el update es un no-op silencioso.
   * Leer la fila de vuelta es la unica prueba posible.
   */
  it("stops a developer from answering a booking that is not theirs", async () => {
    const booking = await pendingBooking(otherDev.id);
    const client = await signInClient(dev.email, password);

    await client.from("bookings").update({ status: "approved" }).eq("id", booking.id);

    const row = await readBack(booking.id);
    expect(row?.status).toBe("pending");
  });

  // Regresion del guard de `004`: aprobar nunca fue del PM, ni antes ni ahora
  // que el dev tiene su propia policy.
  it("still keeps the PM from approving", async () => {
    const booking = await pendingBooking();
    const client = await signInClient(pm.email, password);

    const { error } = await client
      .from("bookings")
      .update({ status: "approved" })
      .eq("id", booking.id);
    expect(error?.code).toBe("23514");

    const row = await readBack(booking.id);
    expect(row?.status).toBe("pending");
  });

  /**
   * El guard del dev pregunta `not can_manage_booking(...)`, asi que a un admin
   * no lo alcanza aunque sea el dev asignado: sigue editando como admin. Si
   * esto se rompiera, un admin desarrollador perderia la mitad de su rol sin
   * que nada lo avisara.
   */
  it("lets an admin who is also the assigned developer keep editing", async () => {
    const booking = await pendingBooking(adminDev.id);
    const client = await signInClient(adminDev.email, password);

    const { error } = await client
      .from("bookings")
      .update({ starts_at: at(15), ends_at: at(17) })
      .eq("id", booking.id);
    expect(error).toBeNull();

    const row = await readBack(booking.id);
    expect(Date.parse(row!.starts_at)).toBe(Date.parse(at(15)));
  });

  /**
   * Q-E: cuando el PM mueve una reserva aprobada, vuelve a `pending` y la
   * respuesta se va con ella. Si `responded_at` sobreviviera, la bandeja
   * mostraria una reserva pendiente que dice haber sido contestada.
   */
  it("clears the answer when the booking goes back to pending", async () => {
    const booking = await pendingBooking();
    const devClient = await signInClient(dev.email, password);
    await devClient
      .from("bookings")
      .update({ status: "approved", response_note: "dale" })
      .eq("id", booking.id);

    const pmClient = await signInClient(pm.email, password);
    const { error } = await pmClient
      .from("bookings")
      .update({ starts_at: at(15), ends_at: at(17), status: "pending" })
      .eq("id", booking.id);
    expect(error).toBeNull();

    const row = await readBack(booking.id);
    expect(row?.status).toBe("pending");
    expect(row?.responded_at).toBeNull();
    expect(row?.response_note).toBeNull();
  });

  // T3.5 - el rastro en audit_log
  // ---------------------------------------------------------------------------

  /**
   * Mismo patron que `projects_log_priority_change` (ADR 0005): nadie tiene
   * `insert` sobre `audit_log`, las filas solo las escribe el trigger
   * `security definer`. El rastro no se puede falsificar desde un cliente.
   */
  describe("audit_log on status change", () => {
    async function auditRowsFor(bookingId: string) {
      const { data } = await adminClient()
        .from("audit_log")
        .select("entity, entity_id, action, actor_id, diff")
        .eq("entity_id", bookingId);
      return data ?? [];
    }

    it("records the approval with who, from and to", async () => {
      const booking = await pendingBooking();
      const client = await signInClient(dev.email, password);
      await client.from("bookings").update({ status: "approved" }).eq("id", booking.id);

      const rows = await auditRowsFor(booking.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entity: "booking",
        entity_id: booking.id,
        action: "status_change",
        actor_id: dev.id,
        diff: { from: "pending", to: "approved" },
      });
    });

    it("records the rejection together with its reason", async () => {
      const booking = await pendingBooking();
      const client = await signInClient(dev.email, password);
      await client
        .from("bookings")
        .update({ status: "rejected", response_note: "No llego" })
        .eq("id", booking.id);

      const rows = await auditRowsFor(booking.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "status_change",
        actor_id: dev.id,
        diff: { from: "pending", to: "rejected", response_note: "No llego" },
      });
    });

    /**
     * Se registra **todo** cambio de estado, no solo la respuesta del dev
     * (`plan.md` 3.4): la cancelacion del PM es exactamente el historial del
     * que `007` y `010` van a colgarse.
     */
    it("records the cancellation by the PM too", async () => {
      const booking = await pendingBooking();
      const client = await signInClient(pm.email, password);
      await client.from("bookings").update({ status: "cancelled" }).eq("id", booking.id);

      const rows = await auditRowsFor(booking.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_id: pm.id,
        diff: { from: "pending", to: "cancelled" },
      });
    });

    it("writes nothing when the status is not what changed", async () => {
      const booking = await pendingBooking();
      const client = await signInClient(pm.email, password);
      await client.from("bookings").update({ note: "aclaro el pedido" }).eq("id", booking.id);

      expect(await auditRowsFor(booking.id)).toEqual([]);
    });
  });
});
