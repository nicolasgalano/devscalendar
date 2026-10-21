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
 * Feature 028 — RPC `set_project_active`.
 *
 * El motivo por el que estos tests existen es el mismo que `reallocation.test.ts`:
 * la RLS que la RPC se saltea `security definer` filtra en silencio desde el
 * cliente, así que un bug de autorización se vería como "no hace nada" en vez de
 * un error. **Todas las aserciones leen la fila de vuelta** desde el admin
 * client, no se conforman con el código de error.
 */
describe("set_project_active", () => {
  const password = "Test-password-123!";

  let adminUser: { id: string; email: string };
  let pmA: { id: string; email: string };
  let pmB: { id: string; email: string };
  let contribA: { id: string; email: string };
  let pmInactive: { id: string; email: string };

  let clientId: string;
  let projectA: string;
  let projectB: string;
  let projectInactive: string;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);

    const adm = await createUserWithRole(testEmail(`spa-admin-${suffix}`), password, "admin");
    const projA = await createUserWithRole(testEmail(`spa-pma-${suffix}`), password, "pm");
    const projB = await createUserWithRole(testEmail(`spa-pmb-${suffix}`), password, "pm");
    const cont = await createUserWithRole(
      testEmail(`spa-contrib-${suffix}`),
      password,
      "developer",
    );
    const inactive = await createUserWithRole(
      testEmail(`spa-pm-inactive-${suffix}`),
      password,
      "pm",
      { active: false },
    );

    adminUser = { id: adm.id, email: adm.email! };
    pmA = { id: projA.id, email: projA.email! };
    pmB = { id: projB.id, email: projB.email! };
    contribA = { id: cont.id, email: cont.email! };
    pmInactive = { id: inactive.id, email: inactive.email! };

    clientId = (await createClientRow(`SPA cliente ${suffix}`)).id;

    projectA = (
      await createProjectRow({ name: `SPA proyecto A ${suffix}`, clientId, pmId: pmA.id })
    ).id;
    projectB = (
      await createProjectRow({ name: `SPA proyecto B ${suffix}`, clientId, pmId: pmB.id })
    ).id;
    projectInactive = (
      await createProjectRow({
        name: `SPA proyecto inactivo ${suffix}`,
        clientId,
        pmId: pmInactive.id,
      })
    ).id;

    // contribA es miembro del proyecto A como contributor.
    await adminClient().from("project_members").insert({
      project_id: projectA,
      user_id: contribA.id,
      role_in_project: "contributor",
      active: true,
    });
  });

  afterAll(async () => {
    try {
      await cleanupProject(projectA);
      await cleanupProject(projectB);
      await cleanupProject(projectInactive);
      await cleanupClient(clientId);
    } finally {
      await deleteTestUser(adminUser.id);
      await deleteTestUser(pmA.id);
      await deleteTestUser(pmB.id);
      await deleteTestUser(contribA.id);
      await deleteTestUser(pmInactive.id);
    }
  });

  async function readActive(projectId: string): Promise<boolean> {
    const { data } = await adminClient()
      .from("projects")
      .select("active")
      .eq("id", projectId)
      .single();
    if (!data) throw new Error("proyecto desapareció");
    return data.active;
  }

  async function readAuditCount(projectId: string): Promise<number> {
    const { data } = await adminClient()
      .from("audit_log")
      .select("id")
      .eq("entity_id", projectId)
      .eq("action", "active_toggled");
    return (data ?? []).length;
  }

  it("lets an admin toggle any project and writes the audit row", async () => {
    const before = await readAuditCount(projectA);

    const client = await signInClient(adminUser.email, password);
    const { data, error } = await client.rpc("set_project_active", {
      p_project_id: projectA,
      p_active: false,
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
    expect(await readActive(projectA)).toBe(false);
    expect(await readAuditCount(projectA)).toBe(before + 1);

    const { data: audit } = await adminClient()
      .from("audit_log")
      .select("entity, action, actor_id, diff")
      .eq("entity_id", projectA)
      .eq("action", "active_toggled")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(audit).toMatchObject({
      entity: "project",
      action: "active_toggled",
      actor_id: adminUser.id,
      diff: { old: true, new: false },
    });

    // Deja el proyecto activo para los siguientes tests.
    await adminClient().from("projects").update({ active: true }).eq("id", projectA);
  });

  it("lets the primary PM toggle their own project", async () => {
    const client = await signInClient(pmA.email, password);
    const { data, error } = await client.rpc("set_project_active", {
      p_project_id: projectA,
      p_active: false,
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
    expect(await readActive(projectA)).toBe(false);

    await adminClient().from("projects").update({ active: true }).eq("id", projectA);
  });

  it("rejects a primary PM of a different project with 42501", async () => {
    const client = await signInClient(pmB.email, password);
    const { data, error } = await client.rpc("set_project_active", {
      p_project_id: projectA,
      p_active: false,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
    // La fila no cambia — ese es el chequeo que separa "funcionó" de "la RLS
    // filtró en silencio" (ADR 0010).
    expect(await readActive(projectA)).toBe(true);
  });

  it("rejects a project contributor with 42501", async () => {
    const client = await signInClient(contribA.email, password);
    const { data, error } = await client.rpc("set_project_active", {
      p_project_id: projectA,
      p_active: false,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
    expect(await readActive(projectA)).toBe(true);
  });

  it("is a no-op when toggling to the same state — no audit row added", async () => {
    const before = await readAuditCount(projectA);
    const activeBefore = await readActive(projectA);

    const client = await signInClient(adminUser.email, password);
    const { data, error } = await client.rpc("set_project_active", {
      p_project_id: projectA,
      p_active: activeBefore,
    });
    expect(error).toBeNull();
    expect(data).toBe(activeBefore);
    expect(await readActive(projectA)).toBe(activeBefore);
    expect(await readAuditCount(projectA)).toBe(before);
  });

  it("rejects an unknown project id with DC010", async () => {
    const client = await signInClient(adminUser.email, password);
    const { data, error } = await client.rpc("set_project_active", {
      p_project_id: randomUUID(),
      p_active: false,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("DC010");
    expect(data).toBeNull();
  });

  it("rejects a primary PM whose profile is deactivated with 42501", async () => {
    // pmInactive sigue siendo `projects.pm_id` de projectInactive, pero su
    // `profiles.active = false`, así que `has_role('pm')` lo rechaza — ese es el
    // guard que viene de D-01 y evita que un ex-PM mantenga privilegios por el
    // vínculo del proyecto.
    const client = await signInClient(pmInactive.email, password);
    const { data, error } = await client.rpc("set_project_active", {
      p_project_id: projectInactive,
      p_active: false,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
    expect(await readActive(projectInactive)).toBe(true);
  });
});
