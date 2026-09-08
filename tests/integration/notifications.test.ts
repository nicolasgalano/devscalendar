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

/**
 * T4.2 / T4.3 / T4.4 — feature 010.
 *
 * Lo que se prueba acá no es que el trigger corra: es **a quién le llega cada
 * cosa**, que es la regla entera de la feature. Todo se lee de vuelta con
 * `service_role` — y en este caso el silencio engaña más que nunca, porque una
 * bandeja vacía se parece muchísimo a "todavía no pasó nada".
 */
describe("notifications", () => {
  const password = "Test-password-123!";

  let pm: { id: string; email: string };
  let dev: { id: string; email: string };
  let inactiveDev: { id: string; email: string };
  let clientId: string;
  let projectId: string;

  async function notificationsFor(recipient: string, bookingId?: string) {
    let query = adminClient()
      .from("notifications")
      .select("id, type, recipient_id, booking_id, payload, email_status")
      .eq("recipient_id", recipient);
    if (bookingId) query = query.eq("booking_id", bookingId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  beforeAll(async () => {
    const pmUser = await createUserWithRole(testEmail(`notif-pm-${randomUUID()}`), password, "pm");
    const devUser = await createUserWithRole(
      testEmail(`notif-dev-${randomUUID()}`),
      password,
      "developer",
    );
    const offUser = await createUserWithRole(
      testEmail(`notif-off-${randomUUID()}`),
      password,
      "developer",
      { active: false },
    );

    pm = { id: pmUser.id, email: pmUser.email! };
    dev = { id: devUser.id, email: devUser.email! };
    inactiveDev = { id: offUser.id, email: offUser.email! };

    clientId = (await createClientRow(`010 cliente ${randomUUID()}`)).id;
    projectId = (
      await createProjectRow({ name: `010 proyecto ${randomUUID()}`, clientId, pmId: pm.id })
    ).id;
  });

  afterAll(async () => {
    await cleanupBookings([projectId]);
    await cleanupProject(projectId);
    await cleanupClient(clientId);
    await deleteTestUser(pm.id);
    await deleteTestUser(dev.id);
    await deleteTestUser(inactiveDev.id);
  });

  it("tells the developer when they are booked", async () => {
    const [booking] = await createBookingRows([
      {
        projectId,
        devId: dev.id,
        startsAt: "2026-12-01T12:00:00Z",
        endsAt: "2026-12-01T14:00:00Z",
        status: "pending",
      },
    ]);

    const rows = await notificationsFor(dev.id, booking!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("booking_created");
    // El payload se congela al escribir: el aviso tiene que poder mostrarse sin
    // volver a buscar el proyecto.
    expect((rows[0]!.payload as { project?: string }).project).toBeTruthy();
    expect(rows[0]!.email_status).toBe("pending");
  });

  it("tells the PM when the developer approves, and when they reject — with the reason", async () => {
    const [approved] = await createBookingRows([
      {
        projectId,
        devId: dev.id,
        startsAt: "2026-12-02T12:00:00Z",
        endsAt: "2026-12-02T14:00:00Z",
        status: "pending",
      },
    ]);
    const [rejected] = await createBookingRows([
      {
        projectId,
        devId: dev.id,
        startsAt: "2026-12-03T12:00:00Z",
        endsAt: "2026-12-03T14:00:00Z",
        status: "pending",
      },
    ]);

    const asDev = await signInClient(dev.email, password);
    await asDev.from("bookings").update({ status: "approved" }).eq("id", approved!.id);
    await asDev
      .from("bookings")
      .update({ status: "rejected", response_note: "Esa semana no llego" })
      .eq("id", rejected!.id);

    const approvedRows = await notificationsFor(pm.id, approved!.id);
    expect(approvedRows.map((r) => r.type)).toContain("booking_approved");

    const rejectedRows = await notificationsFor(pm.id, rejected!.id);
    const rejection = rejectedRows.find((r) => r.type === "booking_rejected");
    expect(rejection).toBeDefined();
    // AC-1.2: el motivo viaja en el aviso. Un rechazo sin motivo obliga a entrar
    // a buscarlo, que es justo lo que esto evita.
    expect((rejection!.payload as { response_note?: string }).response_note).toBe(
      "Esa semana no llego",
    );
  });

  it("does not notify you about your own action", async () => {
    // AC-1.6, y con roles múltiples (012) dejó de ser un caso raro: acá el PM
    // aprueba siendo también el desarrollador asignado.
    const pmDev = await createUserWithRole(testEmail(`notif-both-${randomUUID()}`), password, [
      "pm",
      "developer",
    ]);
    const ownProject = await createProjectRow({
      name: `010 propio ${randomUUID()}`,
      clientId,
      pmId: pmDev.id,
    });

    try {
      const asBoth = await signInClient(pmDev.email!, password);
      const { data: created, error } = await asBoth
        .from("bookings")
        .insert({
          project_id: ownProject.id,
          dev_id: pmDev.id,
          starts_at: "2026-12-04T12:00:00Z",
          ends_at: "2026-12-04T14:00:00Z",
        })
        .select("id")
        .single();

      expect(error).toBeNull();

      const rows = await notificationsFor(pmDev.id, created!.id);
      expect(rows).toEqual([]);
    } finally {
      await cleanupBookings([ownProject.id]);
      await cleanupProject(ownProject.id);
      await deleteTestUser(pmDev.id);
    }
  });

  it("tells the developer when their approved booking is cancelled or changed", async () => {
    const [booking] = await createBookingRows([
      {
        projectId,
        devId: dev.id,
        startsAt: "2026-12-05T12:00:00Z",
        endsAt: "2026-12-05T14:00:00Z",
        status: "approved",
      },
    ]);

    const asPm = await signInClient(pm.email, password);
    // Q-E: mover una aprobada la devuelve a pending, y el dev tiene que
    // enterarse de que lo que había aprobado cambió.
    await asPm
      .from("bookings")
      .update({ starts_at: "2026-12-05T15:00:00Z", ends_at: "2026-12-05T17:00:00Z" })
      .eq("id", booking!.id);
    await adminClient().from("bookings").update({ status: "pending" }).eq("id", booking!.id);
    await adminClient().from("bookings").update({ status: "approved" }).eq("id", booking!.id);
    await asPm.from("bookings").update({ status: "cancelled" }).eq("id", booking!.id);

    const types = (await notificationsFor(dev.id, booking!.id)).map((r) => r.type);
    expect(types).toContain("booking_cancelled");
  });

  it("logs create and update in audit_log, which nothing did before 010", async () => {
    // AC-5.1: `005` registraba el cambio de estado y `006` la realocación, pero
    // una reserva creada, o movida sin cambiar de estado, no dejaba rastro.
    const [booking] = await createBookingRows([
      {
        projectId,
        devId: dev.id,
        startsAt: "2026-12-06T12:00:00Z",
        endsAt: "2026-12-06T14:00:00Z",
        status: "pending",
      },
    ]);

    await adminClient().from("bookings").update({ note: "movida" }).eq("id", booking!.id);

    const { data } = await adminClient()
      .from("audit_log")
      .select("action")
      .eq("entity_id", booking!.id);

    const actions = (data ?? []).map((row) => row.action);
    expect(actions).toContain("create");
    expect(actions).toContain("update");
  });

  it("keeps notifications private to their recipient", async () => {
    const asDev = await signInClient(dev.email, password);
    const { data, error } = await asDev.from("notifications").select("id, recipient_id");

    expect(error).toBeNull();
    // La RLS filtra: el dev no ve una sola fila del PM, ni siquiera vacía de
    // contenido.
    expect((data ?? []).every((row) => row.recipient_id === dev.id)).toBe(true);
  });

  it("refuses a hand-written notification", async () => {
    // Sin grant de insert: las filas las escriben los triggers y nadie más, así
    // que la bandeja no se puede falsificar desde un cliente.
    const asPm = await signInClient(pm.email, password);
    const { error } = await asPm.from("notifications").insert({
      recipient_id: dev.id,
      type: "booking_created",
      payload: {},
    });

    expect(error).not.toBeNull();
  });

  it("still lets a deactivated user read what already reached them", async () => {
    // Mismo criterio que `profiles: self read` en 012: el chequeo de `active`
    // corta lo que podés hacer, no lo que te pasó.
    const [booking] = await createBookingRows([
      {
        projectId,
        devId: inactiveDev.id,
        startsAt: "2026-12-07T12:00:00Z",
        endsAt: "2026-12-07T14:00:00Z",
        status: "pending",
      },
    ]);

    const seeded = await notificationsFor(inactiveDev.id, booking!.id);
    expect(seeded).toHaveLength(1);

    const asInactive = await signInClient(inactiveDev.email, password);
    const { data, error } = await asInactive
      .from("notifications")
      .select("id")
      .eq("booking_id", booking!.id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("marks only the caller's own notifications as read", async () => {
    const mine = await notificationsFor(dev.id);
    const theirs = await notificationsFor(pm.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);

    const asDev = await signInClient(dev.email, password);
    const { data: marked, error } = await asDev.rpc("mark_notifications_read", {
      ids: [mine[0]!.id, theirs[0]!.id],
    });

    expect(error).toBeNull();
    // Mandó dos ids y solo una era suya: la ajena no falla, simplemente no se
    // toca. Se lee de vuelta porque el número por sí solo no lo probaría.
    expect(marked).toBe(1);

    const { data: after } = await adminClient()
      .from("notifications")
      .select("id, read_at")
      .in("id", [mine[0]!.id, theirs[0]!.id]);

    const byId = new Map((after ?? []).map((row) => [row.id, row.read_at]));
    expect(byId.get(mine[0]!.id)).not.toBeNull();
    expect(byId.get(theirs[0]!.id)).toBeNull();
  });
});
