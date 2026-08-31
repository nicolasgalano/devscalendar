import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Gate de autenticación compartido por toda la app logueada. Las rutas de auth
 * (`/login`, `/pending-access`, `/auth/*`) viven fuera de este route group.
 *
 * La sesión se pide por `getCurrentProfile()`, que memoriza el resultado por
 * request: los layouts anidados y las pages la reusan sin repetir el round trip
 * al servidor de auth.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Sin sesión → /login. Con sesión pero sin profile utilizable →
  // /pending-access. Son casos distintos: mandar a /login a alguien que sí
  // tiene sesión lo deja rebotando contra el middleware.
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const profile = await getCurrentProfile();
  if (!profile || !profile.active || !profile.role) {
    redirect("/pending-access");
  }

  return (
    <AppShell role={profile.role} userLabel={profile.full_name ?? profile.email}>
      {children}
    </AppShell>
  );
}
