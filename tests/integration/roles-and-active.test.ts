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
  createTestUser,
  createUserWithRole,
  deleteTestUser,
  signInClient,
} from "./helpers";
import { testEmail } from "../run-id";

/**
 * T4.2 / T4.3 — feature 012. Las dos deudas que esta feature salda, contra la
 * base y no contra el código:
 *
 *   D-01  desactivar a alguien le saca los permisos de verdad. Hasta ahora el
 *         único lugar que miraba `active` era un layout de UI.
 *   D-09  alguien puede tener más de un rol, y cada uno vale por separado.
 *
 * **Todo se lee de vuelta con `service_role`.** Un `update` que la RLS filtra
 * devuelve `error: null` y afecta cero filas: mirar el código de error no
 * distingue "lo bloqueó la policy" de "lo escribió", que son justo los dos
 * mundos que hay que separar (ADR 0010, y la lección de `004` T4.2).
 */
describe("multiple roles and active enforcement", () => {
  const password = "Test-password-123!";

  let activeAdmin: { id: string; email: string };
  let inactiveAdmin: { id: string; email: string };
  let pmAdmin: { id: string; email: string };
  let inactiveDev: { id: string; email: string };
  let seededClientId: string;

  beforeAll(async () => {
    const active = await createUserWithRole(
      testEmail(`roles-admin-${randomUUID()}`),
      password,
      "admin",
    );
    const inactive = await createUserWithRole(
      testEmail(`roles-inactive-admin-${randomUUID()}`),
      password,
      "admin",
      { active: false },
    );
    // El caso que D-09 vino a habilitar y que antes no se podía ni construir.
    const both = await createUserWithRole(testEmail(`roles-pm-admin-${randomUUID()}`), password, [
      "pm",
      "admin",
    ]);
    const dev = await createUserWithRole(
      testEmail(`roles-inactive-dev-${randomUUID()}`),
      password,
      "developer",
      { active: false },
    );

    activeAdmin = { id: active.id, email: active.email! };
    inactiveAdmin = { id: inactive.id, email: inactive.email! };
    pmAdmin = { id: both.id, email: both.email! };
    inactiveDev = { id: dev.id, email: dev.email! };

    seededClientId = (await createClientRow(`012 fixture ${randomUUID()}`)).id;
  });

  afterAll(async () => {
    await cleanupClient(seededClientId);
    await deleteTestUser(activeAdmin.id);
    await deleteTestUser(inactiveAdmin.id);
    await deleteTestUser(pmAdmin.id);
    await deleteTestUser(inactiveDev.id);
  });

  // ── D-01 ──────────────────────────────────────────────────────────────────

  it("stops a deactivated admin from writing clients", async () => {
    const client = await signInClient(inactiveAdmin.email, password);
    const name = `deactivated-${randomUUID()}`;

    const { data } = await client.from("clients").insert({ name }).select();
    expect(data ?? []).toEqual([]);

    // Lo que importa: la fila no está. El insert filtrado por RLS sí devuelve
    // error, pero un update filtrado no, así que se comprueba igual por lectura.
    const { data: rows } = await adminClient().from("clients").select("id").eq("name", name);
    expect(rows).toEqual([]);
  });

  it("stops a deactivated admin from editing another profile", async () => {
    const client = await signInClient(inactiveAdmin.email, password);

    const { data, error } = await client
      .from("profiles")
      .update({ roles: ["admin"] })
      .eq("id", activeAdmin.id)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: fresh } = await adminClient()
      .from("profiles")
      .select("roles")
      .eq("id", activeAdmin.id)
      .single();
    expect(fresh?.roles).toEqual(["admin"]);
  });

  it("keeps an active admin working, so the checks above are about `active`", () => {
    // Control positivo: sin esto, los dos de arriba pasarían igual si la policy
    // estuviera rota para todo el mundo.
    return signInClient(activeAdmin.email, password).then(async (client) => {
      const name = `active-admin-${randomUUID()}`;
      const { data, error } = await client.from("clients").insert({ name }).select().single();

      expect(error).toBeNull();
      expect(data?.name).toBe(name);
      if (data?.id) await cleanupClient(data.id);
    });
  });

  it("stops a deactivated user from reading the calendar", async () => {
    // `bookings: team read` pasó de "tenés algún rol" a "tenés algún rol y
    // estás activo".
    const client = await signInClient(inactiveDev.email, password);
    const { data, error } = await client.from("bookings").select("id").limit(1);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("still lets a deactivated user read their own profile", async () => {
    // AC-3.4 / R-4: `profiles: self read` no pasa por `has_role()` a propósito.
    // Sin esto, /pending-access no tendría nada que mostrarle y el usuario
    // quedaría rebotando sin entender por qué.
    const client = await signInClient(inactiveDev.email, password);
    const { data, error } = await client
      .from("profiles")
      .select("id, active")
      .eq("id", inactiveDev.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data?.id).toBe(inactiveDev.id);
    expect(data?.active).toBe(false);
  });

  it("keeps a deactivated developer visible in the team directory", async () => {
    // AC-3.5 / R-5: el calendario imprime el nombre del dev asignado en cada
    // bloque. Si desactivar a alguien lo sacara del directorio, sus reservas
    // viejas perderían el nombre — el bug que arregló la migration 05.
    const client = await signInClient(activeAdmin.email, password);
    const { data } = await client
      .from("profiles")
      .select("id")
      .eq("id", inactiveDev.id)
      .maybeSingle();

    expect(data?.id).toBe(inactiveDev.id);
  });

  it("stops a deactivated developer from answering their own booking", async () => {
    // AC-3.3. Es el caso más caro de los tres: la policy
    // `bookings: developer responds` era `dev_id = auth.uid()` a secas, así que
    // un dev dado de baja seguía aprobando compromisos sobre su propio tiempo.
    const project = await createProjectRow({
      name: `012 respuesta ${randomUUID()}`,
      clientId: seededClientId,
      pmId: pmAdmin.id,
    });
    const [booking] = await createBookingRows([
      {
        projectId: project.id,
        devId: inactiveDev.id,
        startsAt: "2026-10-05T12:00:00Z",
        endsAt: "2026-10-05T14:00:00Z",
        status: "pending",
      },
    ]);

    try {
      const client = await signInClient(inactiveDev.email, password);
      const { data, error } = await client
        .from("bookings")
        .update({ status: "approved" })
        .eq("id", booking!.id)
        .select();

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: fresh } = await adminClient()
        .from("bookings")
        .select("status")
        .eq("id", booking!.id)
        .single();
      expect(fresh?.status).toBe("pending");
    } finally {
      await cleanupBookings([project.id]);
      await cleanupProject(project.id);
    }
  });

  // ── D-09 ──────────────────────────────────────────────────────────────────

  it("treats each role of a pm+admin independently", async () => {
    const client = await signInClient(pmAdmin.email, password);

    // Pasa las policies de admin…
    const name = `pm-admin-${randomUUID()}`;
    const { data: created, error } = await client
      .from("clients")
      .insert({ name })
      .select()
      .single();
    expect(error).toBeNull();
    expect(created?.name).toBe(name);

    // …y además puede ser el pm_id de un proyecto, que es lo que el modelo
    // viejo hacía imposible: `projects.pm_id` exigía `role = 'pm'` exacto.
    const { data: project, error: projectError } = await client
      .from("projects")
      .insert({ name: `012 proyecto ${randomUUID()}`, client_id: created!.id, pm_id: pmAdmin.id })
      .select("id, pm_id")
      .single();

    expect(projectError).toBeNull();
    expect(project?.pm_id).toBe(pmAdmin.id);

    await adminClient().from("projects").delete().eq("id", project!.id);
    await cleanupClient(created!.id);
  });

  it("normalises the role set on write: sorted and deduped", async () => {
    await adminClient()
      .from("profiles")
      .update({ roles: ["developer", "admin", "admin"] })
      .eq("id", pmAdmin.id);

    const { data } = await adminClient()
      .from("profiles")
      .select("roles")
      .eq("id", pmAdmin.id)
      .single();
    expect(data?.roles).toEqual(["admin", "developer"]);

    await adminClient()
      .from("profiles")
      .update({ roles: ["pm", "admin"] })
      .eq("id", pmAdmin.id);
  });

  it("applies a multi-role invitation whole on first login", async () => {
    // AC-1.3. El trigger consume la invitación entera, no su primer valor.
    const email = testEmail(`roles-invite-${randomUUID()}`);
    await adminClient()
      .from("profile_invites")
      .insert({ email, roles: ["pm", "admin"] });

    const user = await createTestUser(email, password);
    try {
      const { data } = await adminClient()
        .from("profiles")
        .select("roles")
        .eq("id", user.id)
        .single();
      expect(data?.roles).toEqual(["admin", "pm"]);
    } finally {
      await deleteTestUser(user.id);
      await adminClient().from("profile_invites").delete().eq("email", email);
    }
  });

  it("gives an uninvited user an empty set, not a null one", async () => {
    // AC-1.5: el estado de /pending-access dejó de ser `null` y pasó a ser `{}`.
    const email = testEmail(`roles-uninvited-${randomUUID()}`);
    const user = await createTestUser(email, password);
    try {
      const { data } = await adminClient()
        .from("profiles")
        .select("roles")
        .eq("id", user.id)
        .single();
      expect(data?.roles).toEqual([]);
    } finally {
      await deleteTestUser(user.id);
    }
  });
});

/**
 * T4.2 / T4.3 — feature 013. Las dos deudas que se saldaron en policies.
 *
 * Se leen las filas de vuelta por el mismo motivo de siempre: la RLS filtra en
 * silencio, y en el caso de `select` el silencio es todavía más engañoso —una
 * lista vacía se parece mucho a "no hay datos"—.
 */
describe("registered debt cleanup", () => {
  const password = "Test-password-123!";

  let provisioned: { id: string; email: string };
  let roleless: { id: string; email: string };
  let deactivated: { id: string; email: string };
  let clientId: string;
  let projectId: string;
  let inactiveProjectId: string;

  beforeAll(async () => {
    const pm = await createUserWithRole(testEmail(`f7-pm-${randomUUID()}`), password, "pm");
    const nobody = await createTestUser(testEmail(`f7-norole-${randomUUID()}`), password);
    const off = await createUserWithRole(testEmail(`f7-off-${randomUUID()}`), password, "pm", {
      active: false,
    });

    provisioned = { id: pm.id, email: pm.email! };
    roleless = { id: nobody.id, email: nobody.email! };
    deactivated = { id: off.id, email: off.email! };

    clientId = (await createClientRow(`013 cliente ${randomUUID()}`)).id;
    projectId = (
      await createProjectRow({
        name: `013 proyecto ${randomUUID()}`,
        clientId,
        pmId: provisioned.id,
      })
    ).id;
    inactiveProjectId = (
      await createProjectRow({
        name: `013 proyecto inactivo ${randomUUID()}`,
        clientId,
        pmId: provisioned.id,
      })
    ).id;
    await adminClient().from("projects").update({ active: false }).eq("id", inactiveProjectId);
  });

  afterAll(async () => {
    await cleanupBookings([projectId, inactiveProjectId]);
    await cleanupProject(projectId);
    await cleanupProject(inactiveProjectId);
    await cleanupClient(clientId);
    await deleteTestUser(provisioned.id);
    await deleteTestUser(roleless.id);
    await deleteTestUser(deactivated.id);
  });

  // ── F7 / D-02 ─────────────────────────────────────────────────────────────

  it("lets a provisioned user read the masters", async () => {
    // Control positivo primero: sin esto, los dos negativos pasarían igual si la
    // policy hubiera quedado cerrada para todo el mundo, y el calendario estaría
    // roto sin que ningún test lo dijera.
    const client = await signInClient(provisioned.email, password);

    const clients = await client.from("clients").select("id").eq("id", clientId);
    const projects = await client.from("projects").select("id").eq("id", projectId);

    expect(clients.data).toHaveLength(1);
    expect(projects.data).toHaveLength(1);
  });

  it("hides the masters from a user with no role", async () => {
    // Es lo que F7 vino a cerrar: completar el OAuth de Google no puede ser, por
    // sí solo, acceso a la lista de clientes y proyectos de la empresa.
    const client = await signInClient(roleless.email, password);

    const clients = await client.from("clients").select("id");
    const projects = await client.from("projects").select("id");

    expect(clients.error).toBeNull();
    expect(projects.error).toBeNull();
    expect(clients.data).toEqual([]);
    expect(projects.data).toEqual([]);
  });

  it("hides the masters from a deactivated user", async () => {
    const client = await signInClient(deactivated.email, password);

    const clients = await client.from("clients").select("id");
    const projects = await client.from("projects").select("id");

    expect(clients.data).toEqual([]);
    expect(projects.data).toEqual([]);
  });

  // ── D-08 ──────────────────────────────────────────────────────────────────

  it("refuses a booking on a deactivated project", async () => {
    const client = await signInClient(provisioned.email, password);

    const { error } = await client.from("bookings").insert({
      project_id: inactiveProjectId,
      dev_id: provisioned.id,
      starts_at: "2026-11-02T12:00:00Z",
      ends_at: "2026-11-02T14:00:00Z",
    });

    expect(error).not.toBeNull();

    const { data: rows } = await adminClient()
      .from("bookings")
      .select("id")
      .eq("project_id", inactiveProjectId);
    expect(rows).toEqual([]);
  });

  it("still lets the PM cancel a booking of a deactivated project", async () => {
    // AC-4.2, y es la razón por la que el chequeo vive en la policy de insert y
    // no en `can_manage_booking()`: desactivar un proyecto bloquea historia
    // nueva, no congela la vieja. Un PM tiene que poder limpiar lo que quedó.
    const [booking] = await createBookingRows([
      {
        projectId: inactiveProjectId,
        devId: provisioned.id,
        startsAt: "2026-11-03T12:00:00Z",
        endsAt: "2026-11-03T14:00:00Z",
        status: "pending",
      },
    ]);

    const client = await signInClient(provisioned.email, password);
    const { error } = await client
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", booking!.id);

    expect(error).toBeNull();

    const { data: fresh } = await adminClient()
      .from("bookings")
      .select("status")
      .eq("id", booking!.id)
      .single();
    expect(fresh?.status).toBe("cancelled");
  });
});
