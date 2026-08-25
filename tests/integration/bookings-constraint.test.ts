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
} from "./helpers";
import { testEmail } from "../run-id";

const password = "Test-password-123!";
const at = (hour: number) =>
  new Date(Date.parse("2026-09-14T03:00:00Z") + hour * 3_600_000).toISOString();

/**
 * El anti doble-booking es el único requisito que la spec funcional marca como
 * no negociable (§12), y el único que no se puede resolver en la capa de
 * aplicación. Estos tests van directo contra el constraint, sin pasar por la
 * API, porque lo que se está verificando es la garantía de la base.
 */
describe("bookings_no_overlap", () => {
  let pm: { id: string };
  let devA: { id: string };
  let devB: { id: string };
  let clientId: string;
  let projectId: string;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    pm = await createUserWithRole(testEmail(`cst-pm-${suffix}`), password, "pm");
    devA = await createUserWithRole(testEmail(`cst-a-${suffix}`), password, "developer");
    devB = await createUserWithRole(testEmail(`cst-b-${suffix}`), password, "developer");

    clientId = (await createClientRow(`CST cliente ${suffix}`)).id;
    projectId = (
      await createProjectRow({ name: `CST proyecto ${suffix}`, clientId, pmId: pm.id })
    ).id;
  });

  afterAll(async () => {
    try {
      await cleanupBookings([projectId]);
      await cleanupProject(projectId);
      await cleanupClient(clientId);
    } finally {
      await deleteTestUser(pm.id);
      await deleteTestUser(devA.id);
      await deleteTestUser(devB.id);
    }
  });

  async function insert(
    devId: string,
    from: number,
    to: number,
    status: "approved" | "pending" = "approved",
  ) {
    return adminClient()
      .from("bookings")
      .insert({
        project_id: projectId,
        dev_id: devId,
        starts_at: at(from),
        ends_at: at(to),
        status,
      })
      .select()
      .single();
  }

  // AC-4.1
  it("rejects two overlapping approved bookings for the same developer", async () => {
    const first = await insert(devA.id, 9, 13);
    expect(first.error).toBeNull();

    const second = await insert(devA.id, 12, 15);
    expect(second.error?.code).toBe("23P01");

    await adminClient().from("bookings").delete().eq("id", first.data!.id);
  });

  // AC-4.2: el conflicto se materializa al aprobar, no al proponer.
  it("lets two overlapping pending bookings coexist", async () => {
    const first = await insert(devA.id, 9, 13, "pending");
    const second = await insert(devA.id, 12, 15, "pending");

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    await adminClient()
      .from("bookings")
      .delete()
      .in("id", [first.data!.id, second.data!.id]);
  });

  /**
   * El borde `[)` del rango. Con `[]` dos bloques consecutivos serían conflicto
   * y un PM no podría encadenar la mañana con la tarde, que es el caso más
   * común del día.
   */
  it("does not treat back-to-back bookings as a conflict", async () => {
    const morning = await insert(devA.id, 9, 13);
    const afternoon = await insert(devA.id, 13, 17);

    expect(morning.error).toBeNull();
    expect(afternoon.error).toBeNull();

    await adminClient()
      .from("bookings")
      .delete()
      .in("id", [morning.data!.id, afternoon.data!.id]);
  });

  it("scopes the conflict to one developer", async () => {
    const one = await insert(devA.id, 9, 13);
    const other = await insert(devB.id, 9, 13);

    expect(one.error).toBeNull();
    expect(other.error).toBeNull();

    await adminClient().from("bookings").delete().in("id", [one.data!.id, other.data!.id]);
  });

  /**
   * R-1. Probarlos en serie no prueba nada: en serie pasa hasta un check
   * aplicativo, que es exactamente lo que el constraint viene a reemplazar. La
   * ventana peligrosa está entre leer y escribir, y solo aparece en paralelo.
   */
  it("keeps exactly one of two concurrent writes for the same slot", async () => {
    const attempts = await Promise.all([
      insert(devA.id, 10, 14),
      insert(devA.id, 10, 14),
      insert(devA.id, 11, 13),
      insert(devA.id, 9, 15),
    ]);

    const persisted = attempts.filter((attempt) => attempt.error === null);
    const rejected = attempts.filter((attempt) => attempt.error?.code === "23P01");

    expect(persisted).toHaveLength(1);
    expect(rejected).toHaveLength(3);

    // Y la base queda con una sola: no es que la API haya filtrado, es que no
    // pudieron entrar.
    const { data } = await adminClient()
      .from("bookings")
      .select("id")
      .eq("dev_id", devA.id)
      .eq("status", "approved");
    expect(data).toHaveLength(1);

    await adminClient().from("bookings").delete().eq("id", persisted[0]!.data!.id);
  });

  it("blocks an update that would create an overlap", async () => {
    const morning = await insert(devA.id, 9, 11);
    const afternoon = await insert(devA.id, 14, 16);

    const { error } = await adminClient()
      .from("bookings")
      .update({ starts_at: at(10) })
      .eq("id", afternoon.data!.id);

    expect(error?.code).toBe("23P01");

    await adminClient()
      .from("bookings")
      .delete()
      .in("id", [morning.data!.id, afternoon.data!.id]);
  });
});
