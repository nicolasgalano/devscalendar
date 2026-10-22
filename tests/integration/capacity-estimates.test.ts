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
 * Feature 029 — tabla `capacity_estimates` + RPCs `upsert_capacity_estimate`
 * y `delete_capacity_estimate`.
 *
 * Los tests leen la fila de vuelta via adminClient, no se conforman con el
 * código de error. Es el mismo criterio que `reallocation.test.ts` y
 * `set-project-active.test.ts`: una autorización rota se vería como un
 * `rpc(...)` que no afecta filas, no como un error — y "funcionó" vs "la
 * RLS filtró en silencio" son los dos mundos que hay que separar.
 */
describe("capacity_estimates: RLS + RPCs", () => {
  const password = "Test-password-123!";

  let adminUser: { id: string; email: string };
  let pmA: { id: string; email: string };
  let pmB: { id: string; email: string };
  let pmInactive: { id: string; email: string };
  let devMemberA: { id: string; email: string };
  let devOutsider: { id: string; email: string };

  let clientId: string;
  let projectA: string;
  let projectB: string;
  let projectInactive: string;

  const date1 = "2026-10-21";
  const date2 = "2026-10-22";

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);

    const adm = await createUserWithRole(testEmail(`ce-admin-${suffix}`), password, "admin");
    const projA = await createUserWithRole(testEmail(`ce-pma-${suffix}`), password, "pm");
    const projB = await createUserWithRole(testEmail(`ce-pmb-${suffix}`), password, "pm");
    const pmInact = await createUserWithRole(
      testEmail(`ce-pm-inactive-${suffix}`),
      password,
      "pm",
      { active: false },
    );
    const member = await createUserWithRole(
      testEmail(`ce-dev-member-${suffix}`),
      password,
      "developer",
    );
    const outsider = await createUserWithRole(
      testEmail(`ce-dev-outsider-${suffix}`),
      password,
      "developer",
    );

    adminUser = { id: adm.id, email: adm.email! };
    pmA = { id: projA.id, email: projA.email! };
    pmB = { id: projB.id, email: projB.email! };
    pmInactive = { id: pmInact.id, email: pmInact.email! };
    devMemberA = { id: member.id, email: member.email! };
    devOutsider = { id: outsider.id, email: outsider.email! };

    clientId = (await createClientRow(`CE cliente ${suffix}`)).id;

    projectA = (
      await createProjectRow({ name: `CE proyecto A ${suffix}`, clientId, pmId: pmA.id })
    ).id;
    projectB = (
      await createProjectRow({ name: `CE proyecto B ${suffix}`, clientId, pmId: pmB.id })
    ).id;
    projectInactive = (
      await createProjectRow({
        name: `CE proyecto inactivo ${suffix}`,
        clientId,
        pmId: pmA.id,
      })
    ).id;

    // devMemberA como contributor activo del proyecto A.
    await adminClient().from("project_members").insert({
      project_id: projectA,
      user_id: devMemberA.id,
      role_in_project: "contributor",
      active: true,
    });

    // Desactivo projectInactive para probar DC004.
    await adminClient().from("projects").update({ active: false }).eq("id", projectInactive);
  });

  afterAll(async () => {
    try {
      // Limpio estimates antes de los proyectos (cascade los borraría igual,
      // pero prefiero el orden explícito para que los test-run-ids se vean
      // en el borrado).
      await adminClient()
        .from("capacity_estimates")
        .delete()
        .in("project_id", [projectA, projectB, projectInactive]);
      await cleanupProject(projectA);
      await cleanupProject(projectB);
      await cleanupProject(projectInactive);
      await cleanupClient(clientId);
    } finally {
      await deleteTestUser(adminUser.id);
      await deleteTestUser(pmA.id);
      await deleteTestUser(pmB.id);
      await deleteTestUser(pmInactive.id);
      await deleteTestUser(devMemberA.id);
      await deleteTestUser(devOutsider.id);
    }
  });

  async function readEstimate(id: string) {
    const { data } = await adminClient()
      .from("capacity_estimates")
      .select("id, project_id, dev_id, date, hours, created_by")
      .eq("id", id)
      .maybeSingle();
    return data;
  }

  async function clearEstimates() {
    await adminClient()
      .from("capacity_estimates")
      .delete()
      .in("project_id", [projectA, projectB, projectInactive]);
  }

  describe("SELECT policy", () => {
    let estimateId: string;

    beforeAll(async () => {
      const { data } = await adminClient()
        .from("capacity_estimates")
        .insert({
          project_id: projectA,
          dev_id: devMemberA.id,
          date: date1,
          hours: 4,
          created_by: adminUser.id,
        })
        .select()
        .single();
      estimateId = data!.id;
    });

    it("lets a project viewer (contributor) read", async () => {
      const client = await signInClient(devMemberA.email, password);
      const { data, error } = await client
        .from("capacity_estimates")
        .select("id, hours")
        .eq("id", estimateId)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data?.hours).toBe(4);
    });

    it("hides the row from a non-member", async () => {
      const client = await signInClient(devOutsider.email, password);
      const { data } = await client
        .from("capacity_estimates")
        .select("id")
        .eq("id", estimateId)
        .maybeSingle();
      expect(data).toBeNull();
    });

    it("lets admin read", async () => {
      const client = await signInClient(adminUser.email, password);
      const { data, error } = await client
        .from("capacity_estimates")
        .select("id")
        .eq("id", estimateId)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data?.id).toBe(estimateId);
    });
  });

  describe("upsert_capacity_estimate", () => {
    it("admin creates a new row and upsert is idempotent on the second call", async () => {
      await clearEstimates();
      const client = await signInClient(adminUser.email, password);

      const { data: first, error: err1 } = await client.rpc("upsert_capacity_estimate", {
        p_project_id: projectA,
        p_dev_id: devMemberA.id,
        p_date: date1,
        p_hours: 4,
      });
      expect(err1).toBeNull();
      expect(first?.hours).toBe(4);
      expect(first?.created_by).toBe(adminUser.id);

      const row1 = await readEstimate(first!.id);
      expect(row1?.hours).toBe(4);

      const { data: second, error: err2 } = await client.rpc("upsert_capacity_estimate", {
        p_project_id: projectA,
        p_dev_id: devMemberA.id,
        p_date: date1,
        p_hours: 6,
      });
      expect(err2).toBeNull();
      expect(second?.id).toBe(first?.id); // misma fila
      expect(second?.hours).toBe(6);

      const row2 = await readEstimate(second!.id);
      expect(row2?.hours).toBe(6);

      // Debe haber UNA sola fila para (projectA, devMemberA, date1) — el
      // unique no se violó.
      const { data: allRows } = await adminClient()
        .from("capacity_estimates")
        .select("id")
        .eq("project_id", projectA)
        .eq("dev_id", devMemberA.id)
        .eq("date", date1);
      expect(allRows?.length).toBe(1);
    });

    it("primary PM manages their own project", async () => {
      await clearEstimates();
      const client = await signInClient(pmA.email, password);

      const { data, error } = await client.rpc("upsert_capacity_estimate", {
        p_project_id: projectA,
        p_dev_id: devMemberA.id,
        p_date: date1,
        p_hours: 2,
      });
      expect(error).toBeNull();
      expect(data?.hours).toBe(2);
      expect(data?.created_by).toBe(pmA.id);
    });

    it("rejects a primary PM of a different project with 42501", async () => {
      await clearEstimates();
      const client = await signInClient(pmB.email, password);
      const { data, error } = await client.rpc("upsert_capacity_estimate", {
        p_project_id: projectA,
        p_dev_id: devMemberA.id,
        p_date: date1,
        p_hours: 2,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
      // Confirma que no quedó fila huérfana.
      const { data: rows } = await adminClient()
        .from("capacity_estimates")
        .select("id")
        .eq("project_id", projectA);
      expect(rows?.length ?? 0).toBe(0);
    });

    it("rejects a project contributor with 42501", async () => {
      const client = await signInClient(devMemberA.email, password);
      const { data, error } = await client.rpc("upsert_capacity_estimate", {
        p_project_id: projectA,
        p_dev_id: devMemberA.id,
        p_date: date1,
        p_hours: 2,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });

    it("rejects a primary PM whose profile is deactivated with 42501", async () => {
      // pmInactive sigue siendo projects.pm_id de projectInactive, pero
      // profiles.active = false — has_role('pm') lo rechaza (D-01).
      // Reactivo el proyecto para aislar: la razón del 42501 es el profile
      // del PM, no el active del proyecto (que daría DC004 primero).
      await adminClient().from("projects").update({ active: true }).eq("id", projectInactive);
      try {
        const client = await signInClient(pmInactive.email, password);
        const { data, error } = await client.rpc("upsert_capacity_estimate", {
          p_project_id: projectInactive,
          p_dev_id: pmInactive.id,
          p_date: date1,
          p_hours: 2,
        });
        expect(error).not.toBeNull();
        expect(error?.code).toBe("42501");
        expect(data).toBeNull();
      } finally {
        await adminClient()
          .from("projects")
          .update({ active: false })
          .eq("id", projectInactive);
      }
    });

    it("rejects an inactive project with DC004", async () => {
      const client = await signInClient(adminUser.email, password);
      const { data, error } = await client.rpc("upsert_capacity_estimate", {
        p_project_id: projectInactive,
        p_dev_id: devMemberA.id,
        p_date: date1,
        p_hours: 2,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("DC004");
      expect(data).toBeNull();
    });

    it("rejects invalid hour values with DC011", async () => {
      const client = await signInClient(adminUser.email, password);
      for (const hours of [0.0, 24.5, -1]) {
        const { data, error } = await client.rpc("upsert_capacity_estimate", {
          p_project_id: projectA,
          p_dev_id: devMemberA.id,
          p_date: date1,
          p_hours: hours,
        });
        expect(error?.code, `expected DC011 for hours=${hours}`).toBe("DC011");
        expect(data).toBeNull();
      }
    });

    it("rejects a dev that is not an active member with DC012", async () => {
      const client = await signInClient(adminUser.email, password);
      const { data, error } = await client.rpc("upsert_capacity_estimate", {
        p_project_id: projectA,
        p_dev_id: devOutsider.id,
        p_date: date1,
        p_hours: 2,
      });
      expect(error?.code).toBe("DC012");
      expect(data).toBeNull();
    });

    it("accepts the primary PM as `p_dev_id` even without a project_members row", async () => {
      // El PM primario (pmA) puede no estar en project_members. La RPC lo
      // acepta por la rama "or v_pm_id = p_dev_id".
      await adminClient()
        .from("project_members")
        .delete()
        .eq("project_id", projectA)
        .eq("user_id", pmA.id);

      await clearEstimates();
      const client = await signInClient(adminUser.email, password);
      const { data, error } = await client.rpc("upsert_capacity_estimate", {
        p_project_id: projectA,
        p_dev_id: pmA.id,
        p_date: date2,
        p_hours: 3,
      });
      expect(error).toBeNull();
      expect(data?.dev_id).toBe(pmA.id);
    });
  });

  describe("delete_capacity_estimate", () => {
    async function seed() {
      const { data } = await adminClient()
        .from("capacity_estimates")
        .insert({
          project_id: projectA,
          dev_id: devMemberA.id,
          date: date1,
          hours: 4,
          created_by: adminUser.id,
        })
        .select()
        .single();
      return data!.id;
    }

    it("lets admin delete", async () => {
      await clearEstimates();
      const id = await seed();
      const client = await signInClient(adminUser.email, password);
      const { data, error } = await client.rpc("delete_capacity_estimate", { p_id: id });
      expect(error).toBeNull();
      expect(data).toBe(true);
      expect(await readEstimate(id)).toBeNull();
    });

    it("lets the primary PM of the project delete", async () => {
      await clearEstimates();
      const id = await seed();
      const client = await signInClient(pmA.email, password);
      const { data, error } = await client.rpc("delete_capacity_estimate", { p_id: id });
      expect(error).toBeNull();
      expect(data).toBe(true);
      expect(await readEstimate(id)).toBeNull();
    });

    it("rejects a PM of a different project with 42501 and leaves the row", async () => {
      await clearEstimates();
      const id = await seed();
      const client = await signInClient(pmB.email, password);
      const { data, error } = await client.rpc("delete_capacity_estimate", { p_id: id });
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
      expect(await readEstimate(id)).not.toBeNull();
    });

    it("rejects a project contributor with 42501", async () => {
      await clearEstimates();
      const id = await seed();
      const client = await signInClient(devMemberA.email, password);
      const { data, error } = await client.rpc("delete_capacity_estimate", { p_id: id });
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
      expect(await readEstimate(id)).not.toBeNull();
    });

    it("returns DC010 for an unknown id", async () => {
      const client = await signInClient(adminUser.email, password);
      const { data, error } = await client.rpc("delete_capacity_estimate", {
        p_id: randomUUID(),
      });
      expect(error?.code).toBe("DC010");
      expect(data).toBeNull();
    });

    it("deletes estimations of an inactive project (D-08: clean-up stays open)", async () => {
      // Movemos la estimación al proyecto inactivo y verificamos que el PM
      // primario pueda borrarla aunque el proyecto esté desactivado.
      await clearEstimates();
      const { data: seeded } = await adminClient()
        .from("capacity_estimates")
        .insert({
          project_id: projectInactive,
          dev_id: pmA.id,
          date: date1,
          hours: 4,
          created_by: adminUser.id,
        })
        .select()
        .single();
      const id = seeded!.id;

      const client = await signInClient(pmA.email, password);
      const { data, error } = await client.rpc("delete_capacity_estimate", { p_id: id });
      expect(error).toBeNull();
      expect(data).toBe(true);
      expect(await readEstimate(id)).toBeNull();
    });
  });
});
