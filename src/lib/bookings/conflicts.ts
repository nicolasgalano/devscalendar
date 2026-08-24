import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/** Postgres `exclusion_violation` — what `bookings_no_overlap` raises. */
export const EXCLUSION_VIOLATION = "23P01";

export type BookingConflict = {
  id: string;
  startsAt: string;
  endsAt: string;
  projectName: string;
  devName: string;
};

/**
 * Finds the approved booking that blocks a slot.
 *
 * Postgres tells us *that* there is a conflict, never *which* row it is, so the
 * handler has to go look for it. Without this the PM reads "there is a
 * conflict" and has to hunt through the calendar for it — AC-1.2 asks for the
 * conflicting booking, not just the refusal.
 *
 * The overlap condition mirrors the constraint: `starts_at < ends` and
 * `ends_at > starts`, so two back-to-back bookings are not a conflict.
 */
export async function findConflictingBooking(
  supabase: SupabaseClient<Database>,
  {
    devId,
    startsAt,
    endsAt,
    excludeId,
  }: { devId: string; startsAt: string; endsAt: string; excludeId?: string },
): Promise<BookingConflict | null> {
  let query = supabase
    .from("bookings")
    .select(
      `id, starts_at, ends_at,
       dev:profiles!bookings_dev_id_fkey (full_name, email),
       project:projects!inner (name)`,
    )
    .eq("dev_id", devId)
    .eq("status", "approved")
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt)
    .limit(1);

  if (excludeId) query = query.neq("id", excludeId);

  const { data } = await query.maybeSingle();
  if (!data) return null;

  return {
    id: data.id,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    projectName: data.project.name,
    devName: data.dev.full_name ?? data.dev.email,
  };
}
