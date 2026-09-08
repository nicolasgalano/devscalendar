import { NextResponse } from "next/server";

import { isAdmin } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type AdminGuard =
  | { ok: true; supabase: SupabaseServerClient; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Verifies the caller is authenticated, **active**, and holds the 'admin' role.
 * All /api/clients, /api/projects and /api/users mutations are admin-only (see
 * plan.md#4).
 *
 * The `active` half is feature 012 settling D-01. This guard used to select
 * `role` alone, which meant deactivating an admin took away the screens and
 * left the API wide open: no route has a layout to redirect them, and logging
 * in with Google again handed them a fresh session. The database now refuses
 * them too (`has_role()` folds in `active`), so this check is what turns that
 * refusal into a readable 403 instead of an empty result.
 */
export async function requireAdmin(): Promise<AdminGuard> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No autenticado" }, { status: 401 }),
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("roles, active")
    .eq("id", user.id)
    .single();

  if (!profile?.active || !isAdmin(profile.roles)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Requiere rol admin" }, { status: 403 }),
    };
  }

  return { ok: true, supabase, userId: user.id };
}
