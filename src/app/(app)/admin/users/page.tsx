import { createClient } from "@/lib/supabase/server";

import { UsersTable } from "./users-table";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = await createClient();

  const [profilesResult, invitesResult, pmsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, role, active, primary_pm_id")
      .order("email"),
    supabase.from("profile_invites").select("email, role, created_at").order("created_at"),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "pm")
      .eq("active", true)
      .order("full_name"),
  ]);

  // §9: el estado de error se propaga al error boundary de la ruta.
  const failure = profilesResult.error ?? invitesResult.error ?? pmsResult.error;
  if (failure) throw new Error(failure.message);

  return (
    <UsersTable
      profiles={profilesResult.data ?? []}
      invites={invitesResult.data ?? []}
      pms={pmsResult.data ?? []}
    />
  );
}
