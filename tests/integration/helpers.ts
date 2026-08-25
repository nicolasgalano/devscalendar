import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { loadTestEnv } from "../env";
import { testEmail, testName } from "../run-id";

// El guard vuelve a correr acá, no solo en `setup.ts`: es la única forma de que
// un archivo que importe estos helpers desde otro proyecto de Vitest herede la
// misma protección sin acordarse de nada.
const { url: SUPABASE_URL, anonKey: ANON_KEY, serviceRoleKey: SERVICE_ROLE_KEY } =
  loadTestEnv();

export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * El email llega ya armado por `testEmail()` desde el test, y **no se reescribe
 * acá**.
 *
 * Se intentó al revés —que el helper aplicara la convención solo— y rompió dos
 * veces: un test inicia sesión con el mismo literal que usó para crear, y
 * `profile-invites` inserta una invitación para un email y espera que el
 * trigger la consuma al crearse ese usuario. En los dos casos el email es
 * **dato**, no una etiqueta decorativa, y cambiarlo por debajo rompe la premisa
 * del test.
 */
export async function createTestUser(email: string, password: string) {
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  return data.user;
}

export async function deleteTestUser(userId: string) {
  await adminClient().auth.admin.deleteUser(userId);
}

export async function signInClient(
  email: string,
  password: string,
): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

type UserRole = Database["public"]["Enums"]["user_role"];

/**
 * Creates an auth user and promotes their auto-provisioned profile to `role`.
 * The `handle_new_user` trigger creates the profile with a null role, so tests
 * that need a specific role have to set it through the service-role client.
 */
export async function createUserWithRole(
  email: string,
  password: string,
  role: UserRole,
) {
  const user = await createTestUser(email, password);
  const { error } = await adminClient()
    .from("profiles")
    .update({ role })
    .eq("id", user.id);
  if (error) throw error;
  return user;
}

/** El nombre viaja con el prefijo `[test:<runId>]`. Usá el `data` devuelto. */
export async function createClientRow(name: string) {
  const { data, error } = await adminClient()
    .from("clients")
    .insert({ name: testName(name) })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createProjectRow(input: {
  name: string;
  clientId: string;
  pmId: string;
  priority?: string;
}) {
  const { data, error } = await adminClient()
    .from("projects")
    .insert({
      name: testName(input.name),
      client_id: input.clientId,
      pm_id: input.pmId,
      priority: input.priority ?? "normal",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Inserts bookings through `service_role`. There is no other way: feature 003
 * ships the table read-only on purpose, and the write path belongs to 004.
 */
export async function createBookingRows(
  rows: {
    projectId: string;
    devId: string;
    createdBy?: string;
    startsAt: string;
    endsAt: string;
    status?: string;
  }[],
) {
  const { data, error } = await adminClient()
    .from("bookings")
    .insert(
      rows.map((row) => ({
        project_id: row.projectId,
        dev_id: row.devId,
        created_by: row.createdBy ?? null,
        starts_at: row.startsAt,
        ends_at: row.endsAt,
        status: row.status ?? "approved",
      })),
    )
    .select();
  if (error) throw error;
  return data;
}

export async function cleanupBookings(projectIds: string[]) {
  if (projectIds.length === 0) return;
  await adminClient().from("bookings").delete().in("project_id", projectIds);
}

/** Removes rows created by a test, children first to respect the FKs. */
export async function cleanupProject(projectId: string) {
  const admin = adminClient();
  await admin.from("audit_log").delete().eq("entity_id", projectId);
  await admin.from("projects").delete().eq("id", projectId);
}

export async function cleanupClient(clientId: string) {
  await adminClient().from("clients").delete().eq("id", clientId);
}
