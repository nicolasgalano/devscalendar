import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProjectPriority } from "@/lib/validation/calendar";
import type { Database } from "@/types/database";

/** Postgres `exclusion_violation` — what `bookings_no_overlap` raises. */
export const EXCLUSION_VIOLATION = "23P01";

export type BookingConflict = {
  id: string;
  startsAt: string;
  endsAt: string;
  projectName: string;
  devName: string;
  /**
   * Of the project that holds the slot, not of the one asking for it (006).
   * Whether it can be taken is `canDisplace(newPriority, projectPriority)` — the
   * rule stays in `priority.ts`, so this is the fact and not the verdict.
   */
  projectPriority: ProjectPriority;
  /** Who to talk to when the answer is a tie (AC-1.3). Null if the PM is gone. */
  pmName: string | null;
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
      // `priority` and the project's PM are what 006 needs to tell a conflict
      // that can be displaced from one that cannot. The nested embed is a left
      // join on purpose: `pm_id` is not null, but a deactivated PM should not
      // make a conflict disappear from the answer.
      `id, starts_at, ends_at,
       dev:profiles!bookings_dev_id_fkey (full_name, email),
       project:projects!inner (
         name,
         priority,
         pm:profiles!projects_pm_id_fkey (full_name, email)
       )`,
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
    projectPriority: data.project.priority as ProjectPriority,
    pmName: data.project.pm?.full_name ?? data.project.pm?.email ?? null,
  };
}
