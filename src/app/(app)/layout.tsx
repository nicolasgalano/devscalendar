import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Gate de autenticación compartido por toda la app logueada. Las rutas de auth
 * (`/login`, `/pending-access`, `/auth/*`) viven fuera de este route group.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.active || !profile.role) {
    redirect("/pending-access");
  }

  return (
    <AppShell isAdmin={profile.role === "admin"} userLabel={profile.full_name ?? profile.email}>
      {children}
    </AppShell>
  );
}
