import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Profile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "email" | "role" | "active"
>;

/**
 * Session and profile for the current request, resolved **once**.
 *
 * `supabase.auth.getUser()` is not a local JWT decode: it is an HTTP round trip
 * to the auth server, measured at ~200 ms against the local stack. Layouts nest
 * — `(app)/layout` and `(app)/admin/layout` both need the user — so calling it
 * directly in each one paid that cost twice per navigation, sequentially,
 * before any data query ran.
 *
 * `cache()` deduplicates per render pass: the first caller pays, the rest read
 * the memoised result. It does **not** cache across requests, so there is no
 * risk of serving one user's session to another.
 *
 * The middleware still does its own call, on purpose: it runs in a separate
 * invocation with no access to this cache, and its job is refreshing the token
 * before the render begins.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, active")
    .eq("id", user.id)
    .maybeSingle();

  return data;
});
