import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Guard de rol. La sesión y el shell ya los resuelve `(app)/layout.tsx`, y
 * `getCurrentProfile()` está memorizada por request, así que este guard no
 * cuesta ninguna llamada extra: reusa lo que ya resolvió el layout padre.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  if (profile?.role !== "admin") {
    redirect("/");
  }

  return <>{children}</>;
}
