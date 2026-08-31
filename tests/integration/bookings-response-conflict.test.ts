import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findConflictingBooking } from "@/lib/bookings/conflicts";

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
// Fecha propia del archivo, distinta de la de `bookings-response-rls`: los
// archivos corren en paralelo y los dos aprueban reservas.
const at = (hour: number) =>
  new Date(Date.parse("2026-12-07T03:00:00Z") + hour * 3_600_000).toISOString();

/**
 * Lo que solo aparece cuando el desarrollador puede escribir: el constraint
 * anti doble-booking disparandose de verdad, y la carrera entre la edicion del
 * PM y la aprobacion del dev.
 *
 * El `exclusion constraint` de `004` solo excluye entre `approved`, asi que
 * hasta esta feature nunca tuvo dos filas que comparar (ADR 0008). Estos tests
 * son la primera vez que se lo ve trabajar.
 */
describe("bookings response conflicts", () => {
  let pm: { id: string; email: string };
  let dev: { id: string; email: string };
  let clientId: string;
  let projectId: string;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const manager = await createUserWithRole(testEmail(`cnf-pm-${suffix}`), password, "pm");
    const developer = await createUserWithRole(
      testEmail(`cnf-dev-${suffix}`),
      password,
      "developer",
    );

    pm = { id: manager.id, email: manager.email! };
    dev = { id: developer.id, email: developer.email! };

    clientId = (await createClientRow(`CNF cliente ${suffix}`)).id;
    projectId = (await createProjectRow({ name: `CNF proyecto ${suffix}`, clientId, pmId: pm.id }))
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
    }
  });

  async function booking(from: number, to: number, status: "pending" | "approved") {
    const { data, error } = await adminClient()
      .from("bookings")
      .insert({
        project_id: projectId,
        dev_id: dev.id,
        created_by: pm.id,
        starts_at: at(from),
        ends_at: at(to),
        status,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function dropAll() {
    await adminClient().from("bookings").delete().eq("project_id", projectId);
  }

  // T3.3 - el conflicto al aprobar
  // ---------------------------------------------------------------------------

  it("refuses an approval that would overlap an approved booking", async () => {
    const taken = await booking(9, 13, "approved");
    const asked = await booking(12, 15, "pending");

    const client = await signInClient(dev.email, password);
    const { error } = await client
      .from("bookings")
      .update({ status: "approved" })
      .eq("id", asked.id);

    expect(error?.code).toBe("23P01");

    // Y la reserva sigue pendiente: el constraint no dejo a medias nada.
    const { data } = await adminClient()
      .from("bookings")
      .select("status")
      .eq("id", asked.id)
      .single();
    expect(data?.status).toBe("pending");

    expect(taken.id).toBeTruthy();
    await dropAll();
  });

  /**
   * Postgres avisa *que* hay conflicto, nunca *cual* fila lo produce. El 409 de
   * la API promete devolver la reserva que bloquea, y quien la encuentra es
   * `findConflictingBooking()` - con los embeds de PostgREST que solo un
   * servidor real puede resolver, y ejecutada con el cliente del dev para
   * verificar que su RLS le alcanza para verla.
   */
  it("finds the booking that blocks the slot, with names attached", async () => {
    const taken = await booking(9, 13, "approved");
    const asked = await booking(12, 15, "pending");

    const client = await signInClient(dev.email, password);
    const conflict = await findConflictingBooking(client, {
      devId: dev.id,
      startsAt: asked.starts_at,
      endsAt: asked.ends_at,
      excludeId: asked.id,
    });

    expect(conflict).not.toBeNull();
    expect(conflict?.id).toBe(taken.id);
    expect(conflict?.projectName).toContain("CNF proyecto");
    expect(conflict?.devName).toBeTruthy();

    await dropAll();
  });

  it("sees no conflict when the slots only touch at the edges", async () => {
    await booking(9, 13, "approved");
    const asked = await booking(13, 17, "pending");

    const client = await signInClient(dev.email, password);
    const conflict = await findConflictingBooking(client, {
      devId: dev.id,
      startsAt: asked.starts_at,
      endsAt: asked.ends_at,
      excludeId: asked.id,
    });

    expect(conflict).toBeNull();

    // Y aprobar encadenado funciona, que es el caso mas comun del dia.
    const { error } = await client
      .from("bookings")
      .update({ status: "approved" })
      .eq("id", asked.id);
    expect(error).toBeNull();

    await dropAll();
  });

  // T3.4 - la carrera entre la edicion y la aprobacion (F1 de 004, R-2)
  // ---------------------------------------------------------------------------

  /**
   * El escenario de `plan.md` 5: el dev abre la bandeja y ve "martes 09:00", el
   * PM mueve la reserva mientras el dev decide -Q-E la devuelve a `pending`,
   * asi que sigue en la bandeja con el mismo aspecto-, y el dev aprueba. Sin
   * proteccion, acaba de comprometerse a un horario que nunca vio.
   *
   * La proteccion es el `.eq("updated_at", ...)` del handler, que es lo que se
   * reproduce aca tal cual.
   */
  it("does not let a stale answer land after the PM moved the booking", async () => {
    const asked = await booking(9, 13, "pending");
    const staleUpdatedAt = asked.updated_at;

    const pmClient = await signInClient(pm.email, password);
    const { error: editError } = await pmClient
      .from("bookings")
      .update({ starts_at: at(15), ends_at: at(19) })
      .eq("id", asked.id);
    expect(editError).toBeNull();

    const devClient = await signInClient(dev.email, password);
    const { data: written, error } = await devClient
      .from("bookings")
      .update({ status: "approved" })
      .eq("id", asked.id)
      .eq("updated_at", staleUpdatedAt)
      .select()
      .maybeSingle();

    // Cero filas y ningun error: no hay nada que actualizar porque la fila ya
    // no es la que el dev vio. El handler traduce esto al 409 de plan.md 5.
    expect(error).toBeNull();
    expect(written).toBeNull();

    const { data } = await adminClient()
      .from("bookings")
      .select("status")
      .eq("id", asked.id)
      .single();
    expect(data?.status).toBe("pending");

    await dropAll();
  });

  /**
   * La contraparte: con el `updated_at` fresco la respuesta entra. Sin este
   * test, uno que solo mire el caso viejo pasaria igual si el `.eq()` estuviera
   * siempre fallando.
   */
  it("lets the answer land when the booking has not moved", async () => {
    const asked = await booking(9, 13, "pending");

    const devClient = await signInClient(dev.email, password);
    const { data: written, error } = await devClient
      .from("bookings")
      .update({ status: "approved" })
      .eq("id", asked.id)
      .eq("updated_at", asked.updated_at)
      .select()
      .maybeSingle();

    expect(error).toBeNull();
    expect(written?.status).toBe("approved");

    await dropAll();
  });

  // T3.6 - concurrencia
  // ---------------------------------------------------------------------------

  /**
   * R-4. En serie esto pasa hasta con un chequeo aplicativo, que es justo lo
   * que el constraint viene a reemplazar: la ventana peligrosa esta entre leer
   * y escribir, y solo aparece en paralelo.
   *
   * Es tambien la razon por la que el handler no hace un chequeo previo de
   * conflicto antes de aprobar: con dos aprobaciones simultaneas el arbitro
   * tiene que ser el constraint.
   */
  it("keeps exactly one of two concurrent approvals for overlapping slots", async () => {
    const first = await booking(10, 14, "pending");
    const second = await booking(11, 13, "pending");
    const third = await booking(9, 15, "pending");

    const client = await signInClient(dev.email, password);
    const attempts = await Promise.all(
      [first, second, third].map((row) =>
        client.from("bookings").update({ status: "approved" }).eq("id", row.id),
      ),
    );

    const persisted = attempts.filter((attempt) => attempt.error === null);
    const rejected = attempts.filter((attempt) => attempt.error?.code === "23P01");

    expect(persisted).toHaveLength(1);
    expect(rejected).toHaveLength(2);

    // Y la base queda con una sola aprobada: no es que la API haya filtrado, es
    // que las otras no pudieron entrar.
    const { data } = await adminClient()
      .from("bookings")
      .select("id")
      .eq("project_id", projectId)
      .eq("status", "approved");
    expect(data).toHaveLength(1);

    await dropAll();
  });
});
