import { redirect } from "next/navigation";

import { isDeveloper } from "@/lib/auth/roles";
import { getCurrentProfile } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * T4.1 — guard de rol, mismo patrón que `(app)/admin/layout.tsx`. La sesión y
 * el shell ya los resolvió `(app)/layout.tsx`, y `getCurrentProfile()` está
 * memorizada por request, así que esto no cuesta un round trip extra.
 *
 * La bandeja es del desarrollador y de nadie más. Un admin **no** la ve, aunque
 * pueda todo lo demás: no tiene reservas propias que responder, y una bandeja
 * vacía permanente en su navegación sería ruido. Si algún día un admin tiene
 * que responder por alguien, eso es delegación — está fuera del MVP a propósito
 * (`spec.md` §5).
 *
 * **Con roles múltiples (`012`) eso se lee mejor de lo que se leía:** el
 * criterio nunca fue "no ser admin", era "ser desarrollador". Alguien con
 * `admin` **y** `developer` sí ve su bandeja, porque tiene reservas propias que
 * responder. Lo que no existe es la bandeja de un admin que no es dev.
 */
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  if (!profile?.active || !isDeveloper(profile.roles)) {
    redirect("/");
  }

  return <>{children}</>;
}
