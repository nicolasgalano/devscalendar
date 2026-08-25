import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
const at = (hour: number) =>
  new Date(Date.parse("2026-11-09T03:00:00Z") + hour * 3_600_000).toISOString();

/**
 * El alcance de la escritura: el PM manda en *sus* proyectos, no en los del
 * resto. Esto se verifica contra la RLS directamente, no a través de la API,
 * porque la API tiene su propio guard y taparía un agujero de la policy.
 */
describe("bookings write RLS", () => {
  let pmOwner: { id: string; email: string };
  let pmOther: { id: string; email: string };
  let dev: { id: string; email: string };
  let clientId: string;
  let ownedProject: string;
  let foreignProject: string;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const owner = await createUserWithRole(testEmail(`wr-pm1-${suffix}`), password, "pm");
    const other = await createUserWithRole(testEmail(`wr-pm2-${suffix}`), password, "pm");
    const developer = await createUserWithRole(
      testEmail(`wr-dev-${suffix}`),
      password,
      "developer",
    );

    pmOwner = { id: owner.id, email: owner.email! };
    pmOther = { id: other.id, email: other.email! };
    dev = { id: developer.id, email: developer.email! };

    clientId = (await createClientRow(`WR cliente ${suffix}`)).id;
    ownedProject = (
      await createProjectRow({ name: `WR propio ${suffix}`, clientId, pmId: pmOwner.id })
    ).id;
    foreignProject = (
      await createProjectRow({ name: `WR ajeno ${suffix}`, clientId, pmId: pmOther.id })
    ).id;
  });

  afterAll(async () => {
    try {
      await cleanupBookings([ownedProject, foreignProject]);
      await cleanupProject(ownedProject);
      await cleanupProject(foreignProject);
      await cleanupClient(clientId);
    } finally {
      await deleteTestUser(pmOwner.id);
      await deleteTestUser(pmOther.id);
      await deleteTestUser(dev.id);
    }
  });

  it("lets a PM create bookings on their own project", async () => {
    const client = await signInClient(pmOwner.email, password);
    const { data, error } = await client
      .from("bookings")
      .insert({
        project_id: ownedProject,
        dev_id: dev.id,
        starts_at: at(9),
        ends_at: at(11),
      })
      .select()
      .single();

    expect(error).toBeNull();
    await adminClient().from("bookings").delete().eq("id", data!.id);
  });

  it("stops a PM from creating bookings on someone else's project", async () => {
    const client = await signInClient(pmOwner.email, password);
    const { error } = await client.from("bookings").insert({
      project_id: foreignProject,
      dev_id: dev.id,
      starts_at: at(9),
      ends_at: at(11),
    });

    expect(error).not.toBeNull();
  });

  it("stops a PM from editing a booking on someone else's project", async () => {
    const { data: foreign } = await adminClient()
      .from("bookings")
      .insert({
        project_id: foreignProject,
        dev_id: dev.id,
        starts_at: at(14),
        ends_at: at(16),
      })
      .select()
      .single();

    const client = await signInClient(pmOwner.email, password);
    await client.from("bookings").update({ note: "no debería" }).eq("id", foreign!.id);

    // RLS convierte el update en un no-op silencioso, así que el error no
    // alcanza como prueba: hay que leer la fila de vuelta.
    const { data } = await adminClient()
      .from("bookings")
      .select("note")
      .eq("id", foreign!.id)
      .single();
    expect(data?.note).toBeNull();

    await adminClient().from("bookings").delete().eq("id", foreign!.id);
  });

  it("stops a developer from creating their own bookings", async () => {
    const client = await signInClient(dev.email, password);
    const { error } = await client.from("bookings").insert({
      project_id: ownedProject,
      dev_id: dev.id,
      starts_at: at(9),
      ends_at: at(11),
    });

    expect(error).not.toBeNull();
  });
});
