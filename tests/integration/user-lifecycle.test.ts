import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminClient,
  cleanupClient,
  cleanupProject,
  createClientRow,
  createProjectRow,
  createUserWithRole,
  deleteTestUser,
  signInClient,
} from "./helpers";

/**
 * Regresión: dar de baja a un usuario no puede quedar bloqueado por las
 * referencias blandas que lo apuntan (PM primario, invitaciones enviadas,
 * autoría de una entrada de auditoría). Un `on delete` mal elegido en esas FKs
 * hace imposible borrar usuarios, y no se nota hasta que alguien lo intenta.
 */
describe("deleting a user with soft references", () => {
  const password = "Test-password-123!";
  let clientId: string;

  beforeAll(async () => {
    const row = await createClientRow(`Lifecycle fixture ${randomUUID()}`);
    clientId = row.id;
  });

  afterAll(async () => {
    await cleanupClient(clientId);
  });

  it("nulls primary_pm_id on the devs that pointed at the deleted PM", async () => {
    const pm = await createUserWithRole(`life-pm-${randomUUID()}@example.com`, password, "pm");
    const dev = await createUserWithRole(
      `life-dev-${randomUUID()}@example.com`,
      password,
      "developer",
    );

    try {
      await adminClient().from("profiles").update({ primary_pm_id: pm.id }).eq("id", dev.id);

      await deleteTestUser(pm.id);

      const { data } = await adminClient()
        .from("profiles")
        .select("id, primary_pm_id")
        .eq("id", dev.id)
        .single();

      expect(data).toMatchObject({ id: dev.id, primary_pm_id: null });
    } finally {
      // Si la aserción falla, el PM puede seguir existiendo: hay que soltar la
      // referencia antes de poder borrarlo.
      await adminClient().from("profiles").update({ primary_pm_id: null }).eq("id", dev.id);
      await deleteTestUser(dev.id);
      await deleteTestUser(pm.id);
    }
  });

  it("keeps invitations sent by a deleted admin", async () => {
    const admin = await createUserWithRole(
      `life-admin-${randomUUID()}@example.com`,
      password,
      "admin",
    );
    const invitedEmail = `life-invited-${randomUUID()}@example.com`;

    try {
      await adminClient()
        .from("profile_invites")
        .insert({ email: invitedEmail, role: "developer", invited_by: admin.id });

      await deleteTestUser(admin.id);

      const { data } = await adminClient()
        .from("profile_invites")
        .select("email, invited_by")
        .eq("email", invitedEmail)
        .maybeSingle();

      expect(data).toMatchObject({ email: invitedEmail, invited_by: null });
    } finally {
      await adminClient().from("profile_invites").delete().eq("email", invitedEmail);
      await deleteTestUser(admin.id);
    }
  });

  it("keeps the audit trail after its author is deleted", async () => {
    const admin = await createUserWithRole(
      `life-auditor-${randomUUID()}@example.com`,
      password,
      "admin",
    );
    const pm = await createUserWithRole(
      `life-owner-${randomUUID()}@example.com`,
      password,
      "pm",
    );
    const project = await createProjectRow({
      name: `Lifecycle project ${randomUUID()}`,
      clientId,
      pmId: pm.id,
    });

    try {
      const asAdmin = await signInClient(admin.email!, password);
      await asAdmin.from("projects").update({ priority: "high" }).eq("id", project.id);

      await deleteTestUser(admin.id);

      const { data } = await adminClient()
        .from("audit_log")
        .select("entity_id, action, actor_id")
        .eq("entity_id", project.id)
        .single();

      // La entrada sobrevive; solo pierde el autor.
      expect(data).toMatchObject({
        entity_id: project.id,
        action: "priority_changed",
        actor_id: null,
      });
    } finally {
      await cleanupProject(project.id);
      await deleteTestUser(admin.id);
      await deleteTestUser(pm.id);
    }
  });

  it("refuses to delete a PM that still owns projects", async () => {
    const pm = await createUserWithRole(
      `life-owner2-${randomUUID()}@example.com`,
      password,
      "pm",
    );
    const project = await createProjectRow({
      name: `Owned project ${randomUUID()}`,
      clientId,
      pmId: pm.id,
    });

    try {
      const { error } = await adminClient().auth.admin.deleteUser(pm.id);
      expect(error).not.toBeNull();

      // Sigue existiendo: la baja se bloquea, no se pierde el proyecto.
      const { data } = await adminClient()
        .from("profiles")
        .select("id")
        .eq("id", pm.id)
        .maybeSingle();
      expect(data?.id).toBe(pm.id);
    } finally {
      await cleanupProject(project.id);
      await deleteTestUser(pm.id);
    }
  });
});
