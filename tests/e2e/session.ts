import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";

import { loadTestEnv } from "../env";
import { testEmail, testName } from "../run-id";

// Stack efímero de CI, nunca un proyecto alojado: acá abajo se crean y se
// borran usuarios de auth con la service_role key. El guard está en
// `tests/env.ts` y rechaza cualquier URL que no sea local.
const {
  url: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceRoleKey: SERVICE_ROLE_KEY,
} = loadTestEnv();

type Role = "admin" | "pm" | "developer";

export type TestUser = {
  userId: string;
  email: string;
  password: string;
  fullName: string;
};

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Crea un usuario y le asigna el rol; no toca el navegador. */
export async function createUser(role: Role): Promise<TestUser> {
  const admin = serviceClient();
  const id = randomUUID();
  // Identificador de corrida + uuid: lo primero identifica los registros como
  // datos de prueba, lo segundo evita que dos archivos que corren en paralelo
  // dentro de la misma corrida se pisen.
  const email = testEmail(`e2e-${role}-${id}`);
  const password = `E2e-password-${id}!`;
  // Único: los tests corren en paralelo y varios crean un PM a la vez, así que
  // un nombre compartido vuelve ambiguos los locators por texto.
  const fullName = testName(`QA ${role} ${id.slice(0, 8)}`);

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");

  const { error: roleError } = await admin
    .from("profiles")
    .update({ role, full_name: fullName })
    .eq("id", data.user.id);
  if (roleError) throw roleError;

  return { userId: data.user.id, email, password, fullName };
}

/**
 * El login real es Google OAuth, que no se puede automatizar acá. En su lugar
 * iniciamos sesión con contraseña contra GoTrue y plantamos la cookie con el
 * mismo formato que usa `@supabase/ssr` (`base64-` + JSON de la sesión en
 * base64url). Para la app es indistinguible de una sesión real.
 */
export async function authenticate(context: BrowserContext, user: TestUser) {
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session) throw error ?? new Error("signIn returned no session");

  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  const value =
    "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");

  await context.addCookies([
    {
      name: `sb-${projectRef}-auth-token`,
      value,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

export async function deleteUser(userId: string) {
  await serviceClient().auth.admin.deleteUser(userId);
}

/** Borra por nombre lo que haya creado un test, hijos primero. */
export async function cleanupByName(clientName: string, projectName?: string) {
  const admin = serviceClient();

  if (projectName) {
    const { data: project } = await admin
      .from("projects")
      .select("id")
      .eq("name", projectName)
      .maybeSingle();
    if (project) {
      await admin.from("audit_log").delete().eq("entity_id", project.id);
      await admin.from("projects").delete().eq("id", project.id);
    }
  }
  await admin.from("clients").delete().eq("name", clientName);
}

export async function deleteInvite(email: string) {
  await serviceClient().from("profile_invites").delete().eq("email", email);
}

/**
 * Cliente + proyecto a nombre de un PM, para los tests que escriben reservas.
 * El seed no sirve para eso: sus proyectos son de otro PM, y la RLS —con razón—
 * no deja que un PM reserve sobre ellos.
 */
export async function createProjectFor(
  pmId: string,
  names: { client: string; project: string },
): Promise<{ clientId: string; projectId: string }> {
  const admin = serviceClient();

  const { data: client, error: clientError } = await admin
    .from("clients")
    .insert({ name: names.client })
    .select("id")
    .single();
  if (clientError) throw clientError;

  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({ name: names.project, client_id: client.id, pm_id: pmId })
    .select("id")
    .single();
  if (projectError) throw projectError;

  return { clientId: client.id, projectId: project.id };
}

/** Reserva sembrada con service_role, para estados que la API no deja crear. */
export async function seedBooking(booking: {
  projectId: string;
  devId: string;
  startsAt: string;
  endsAt: string;
  status?: "pending" | "approved";
}) {
  const { error } = await serviceClient().from("bookings").insert({
    project_id: booking.projectId,
    dev_id: booking.devId,
    starts_at: booking.startsAt,
    ends_at: booking.endsAt,
    status: booking.status ?? "approved",
  });
  if (error) throw error;
}

/** Reservas, proyecto y cliente en ese orden: las FK son `restrict`. */
export async function deleteProjectFixture(ids: { clientId: string; projectId: string }) {
  const admin = serviceClient();

  // Los ids se leen antes de borrar: desde 005 cada cambio de estado deja su
  // fila en `audit_log`, que apunta a la reserva por id y sin FK.
  const { data: bookings } = await admin
    .from("bookings")
    .select("id")
    .eq("project_id", ids.projectId);
  const bookingIds = (bookings ?? []).map((row) => row.id);

  await admin.from("bookings").delete().eq("project_id", ids.projectId);
  if (bookingIds.length > 0) {
    await admin.from("audit_log").delete().in("entity_id", bookingIds);
  }
  await admin.from("audit_log").delete().eq("entity_id", ids.projectId);
  await admin.from("projects").delete().eq("id", ids.projectId);
  await admin.from("clients").delete().eq("id", ids.clientId);
}
