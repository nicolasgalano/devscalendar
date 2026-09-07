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
import { testEmail } from "../run-id";

/**
 * T4.1 — feature 002. Escrituras sobre los maestros son solo de admin; el resto
 * de los autenticados puede leer pero no escribir. `profile_invites` no la ve
 * nadie que no sea admin.
 *
 * Los tres casos sobre `profiles` se sumaron el 2026-09-07 por D-06: la única
 * garantía real contra "cualquiera entra a /admin/users y edita roles" es la
 * policy `profiles: admin write`, y no la cubría ningún test — ni acá ni en el
 * E2E, que solo prueba la redirección de la pantalla.
 */
describe("clients / projects / profile_invites / profiles RLS", () => {
  const password = "Test-password-123!";
  let developer: { id: string; email: string };
  let admin: { id: string; email: string };
  let seededClientId: string;

  beforeAll(async () => {
    const dev = await createUserWithRole(
      testEmail(`entities-dev-${randomUUID()}`),
      password,
      "developer",
    );
    const adm = await createUserWithRole(
      testEmail(`entities-admin-${randomUUID()}`),
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
    const email = testEmail(`invited-${randomUUID()}`);
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

  /**
   * Se lee la fila de vuelta con `service_role` a propósito: un update que la
   * RLS filtra **no falla** —afecta cero filas y devuelve `error: null`—, así
   * que mirar el error no distingue "lo bloqueó la policy" de "lo escribió".
   * Es la lección de `004` T4.2 y la misma que exige ADR 0010.
   */
  it("prevents a non-admin from editing another profile", async () => {
    const client = await signInClient(developer.email, password);
    const { data, error } = await client
      .from("profiles")
      .update({ role: "developer", active: false })
      .eq("id", admin.id)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: fresh } = await adminClient()
      .from("profiles")
      .select("role, active")
      .eq("id", admin.id)
      .single();
    expect(fresh?.role).toBe("admin");
    expect(fresh?.active).toBe(true);
  });

  // El caso que importa de verdad: la fila propia sí la ve por `profiles: self
  // read`, así que el bloqueo tiene que venir de la policy de escritura.
  it("prevents a non-admin from promoting themselves to admin", async () => {
    const client = await signInClient(developer.email, password);
    const { data, error } = await client
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", developer.id)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: fresh } = await adminClient()
      .from("profiles")
      .select("role")
      .eq("id", developer.id)
      .single();
    expect(fresh?.role).toBe("developer");
  });

  // Control positivo: sin esto, los dos de arriba pasarían igual si `profiles`
  // fuera de solo lectura para todo el mundo, que no es lo que se quiere probar.
  it("lets an admin change someone's role", async () => {
    const client = await signInClient(admin.email, password);
    try {
      const { data, error } = await client
        .from("profiles")
        .update({ role: "pm" })
        .eq("id", developer.id)
        .select("role");

      expect(error).toBeNull();
      expect(data).toEqual([{ role: "pm" }]);
    } finally {
      // Los demás tests del archivo cuentan con que este usuario sea developer.
      await adminClient().from("profiles").update({ role: "developer" }).eq("id", developer.id);
    }
  });

  it("keeps a user with no role out of the masters", async () => {
    const email = testEmail(`norole-${randomUUID()}`);
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
