import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminClient,
  cleanupClient,
  createClientRow,
  createTestUser,
  createUserWithRole,
  deleteTestUser,
  signInClient,
} from "./helpers";

/**
 * T4.1 — feature 002. Escrituras sobre los maestros son solo de admin; el resto
 * de los autenticados puede leer pero no escribir. `profile_invites` no la ve
 * nadie que no sea admin.
 */
describe("clients / projects / profile_invites RLS", () => {
  const password = "Test-password-123!";
  let developer: { id: string; email: string };
  let admin: { id: string; email: string };
  let seededClientId: string;

  beforeAll(async () => {
    const dev = await createUserWithRole(
      `entities-dev-${randomUUID()}@example.com`,
      password,
      "developer",
    );
    const adm = await createUserWithRole(
      `entities-admin-${randomUUID()}@example.com`,
      password,
      "admin",
    );
    developer = { id: dev.id, email: dev.email! };
    admin = { id: adm.id, email: adm.email! };

    const row = await createClientRow(`RLS fixture ${randomUUID()}`);
    seededClientId = row.id;
  });

  afterAll(async () => {
    await cleanupClient(seededClientId);
    await deleteTestUser(developer.id);
    await deleteTestUser(admin.id);
  });

  it("lets any authenticated user read clients", async () => {
    const client = await signInClient(developer.email, password);
    const { data, error } = await client
      .from("clients")
      .select("id")
      .eq("id", seededClientId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data?.id).toBe(seededClientId);
  });

  it("prevents a non-admin from inserting a client", async () => {
    const client = await signInClient(developer.email, password);
    const { error } = await client.from("clients").insert({ name: `nope-${randomUUID()}` });

    expect(error).not.toBeNull();
  });

  it("prevents a non-admin from updating a client", async () => {
    const client = await signInClient(developer.email, password);
    const { data, error } = await client
      .from("clients")
      .update({ name: "hijacked" })
      .eq("id", seededClientId)
      .select();

    // La policy filtra la fila: no hay error, pero tampoco se actualizó nada.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: fresh } = await adminClient()
      .from("clients")
      .select("name")
      .eq("id", seededClientId)
      .single();
    expect(fresh?.name).not.toBe("hijacked");
  });

  it("prevents a non-admin from inserting a project", async () => {
    const client = await signInClient(developer.email, password);
    const { error } = await client.from("projects").insert({
      name: `nope-${randomUUID()}`,
      client_id: seededClientId,
      pm_id: developer.id,
    });

    expect(error).not.toBeNull();
  });

  it("lets an admin insert and then remove a client", async () => {
    const client = await signInClient(admin.email, password);
    const name = `admin-created-${randomUUID()}`;

    const { data, error } = await client
      .from("clients")
      .insert({ name })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.name).toBe(name);

    if (data?.id) await cleanupClient(data.id);
  });

  it("hides profile_invites from non-admins", async () => {
    const email = `invited-${randomUUID()}@example.com`;
    const { error: seedError } = await adminClient()
      .from("profile_invites")
      .insert({ email, role: "developer" });
    expect(seedError).toBeNull();

    const client = await signInClient(developer.email, password);
    const { data, error } = await client.from("profile_invites").select("email");

    expect(error).toBeNull();
    expect(data).toEqual([]);

    await adminClient().from("profile_invites").delete().eq("email", email);
  });

  it("prevents anyone from writing audit_log directly", async () => {
    const client = await signInClient(admin.email, password);
    const { error } = await client.from("audit_log").insert({
      entity: "project",
      entity_id: randomUUID(),
      action: "priority_changed",
      diff: { old: "normal", new: "high" },
    });

    // Sin grant de insert para `authenticated`: solo el trigger escribe acá.
    expect(error).not.toBeNull();
  });

  it("keeps a user with no role out of the masters", async () => {
    const email = `norole-${randomUUID()}@example.com`;
    const user = await createTestUser(email, password);
    try {
      const client = await signInClient(email, password);
      const { error } = await client.from("clients").insert({ name: `nope-${randomUUID()}` });
      expect(error).not.toBeNull();
    } finally {
      await deleteTestUser(user.id);
    }
  });
});
