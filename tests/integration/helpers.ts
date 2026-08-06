import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

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

export async function createClientRow(name: string) {
  const { data, error } = await adminClient()
    .from("clients")
    .insert({ name })
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
      name: input.name,
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
