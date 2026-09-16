import { HomeDispatcher } from "@/components/home-dispatcher";
import { getCurrentProfile } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Home (feature 017). Reemplaza el `redirect('/calendar')` que vivía acá desde
 * `002` — la agenda ya no es la primera pantalla que ve el usuario. La sesión
 * y el rol ya los resolvió `(app)/layout.tsx`; si el profile no existe o está
 * inactivo, el layout redirigió antes.
 */
export default async function HomePage() {
  const profile = await getCurrentProfile();
  // El gate del layout garantiza que el profile existe; el fallback está por
  // el tipo, no porque el caso pase en runtime.
  if (!profile) return null;

  return <HomeDispatcher roles={profile.roles} />;
}
