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
import { testEmail } from "../run-id";

/**
 * T4.3 y T4.4 — feature 002. El trigger `projects_log_priority_change` registra
 * únicamente los cambios de prioridad, y desactivar un cliente es soft delete:
 * no borra ni toca sus proyectos.
 */
describe("audit_log and soft delete", () => {
  const password = "Test-password-123!";
  let admin: { id: string; email: string };
  let pm: { id: string; email: string };
  let clientId: string;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    const adm = await createUserWithRole(
      testEmail(`audit-admin-${randomUUID()}`),
      password,
      "admin",
    );
    const projectManager = await createUserWithRole(
      testEmail(`audit-pm-${randomUUID()}`),
      password,
      "pm",
    );
    admin = { id: adm.id, email: adm.email! };
    pm = { id: projectManager.id, email: projectManager.email! };

    const row = await createClientRow(`Audit fixture ${randomUUID()}`);
    clientId = row.id;
  });

  afterAll(async () => {
    for (const id of createdProjectIds) await cleanupProject(id);
    await cleanupClient(clientId);
    await deleteTestUser(admin.id);
    await deleteTestUser(pm.id);
  });

  async function newProject(priority = "normal") {
    const project = await createProjectRow({
      name: `Audit project ${randomUUID()}`,
      clientId,
      pmId: pm.id,
      priority,
    });
    createdProjectIds.push(project.id);
    return project;
  }

  it("writes exactly one audit row with the diff when priority changes", async () => {
    const project = await newProject("normal");
    const client = await signInClient(admin.email, password);

    const { error } = await client
      .from("projects")
      .update({ priority: "high" })
      .eq("id", project.id);
    expect(error).toBeNull();

    const { data: rows } = await adminClient()
      .from("audit_log")
      .select("entity, entity_id, action, actor_id, diff")
      .eq("entity_id", project.id);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      entity: "project",
      entity_id: project.id,
      action: "priority_changed",
      actor_id: admin.id,
      diff: { old: "normal", new: "high" },
    });
  });

  it("writes nothing when a field other than priority changes", async () => {
    const project = await newProject("normal");
    const client = await signInClient(admin.email, password);

    const { error } = await client
      .from("projects")
      .update({ name: `Renamed ${randomUUID()}`, jira_enabled: true })
      .eq("id", project.id);
    expect(error).toBeNull();

    const { data: rows } = await adminClient()
      .from("audit_log")
      .select("id")
      .eq("entity_id", project.id);

    expect(rows).toEqual([]);
  });

  it("writes nothing when priority is written with the same value", async () => {
    const project = await newProject("high");
    const client = await signInClient(admin.email, password);

    await client.from("projects").update({ priority: "high" }).eq("id", project.id);

    const { data: rows } = await adminClient()
      .from("audit_log")
      .select("id")
      .eq("entity_id", project.id);

    expect(rows).toEqual([]);
  });

  it("deactivates a client without deleting or touching its projects", async () => {
    const project = await newProject("normal");
    const client = await signInClient(admin.email, password);

    const { error } = await client
      .from("clients")
      .update({ active: false })
      .eq("id", clientId);
    expect(error).toBeNull();

    const { data: clientRow } = await adminClient()
      .from("clients")
      .select("id, active")
      .eq("id", clientId)
      .single();
    expect(clientRow).toMatchObject({ id: clientId, active: false });

    // Soft delete: el proyecto sigue existiendo y sigue activo. La cascada, si
    // se quiere, la decide la UI — no la base de datos.
    const { data: projectRow } = await adminClient()
      .from("projects")
      .select("id, active")
      .eq("id", project.id)
      .single();
    expect(projectRow).toMatchObject({ id: project.id, active: true });

    await adminClient().from("clients").update({ active: true }).eq("id", clientId);
  });
});
