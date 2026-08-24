import type { Database } from "@/types/database";

export type UserRole = Database["public"]["Enums"]["user_role"];

/** Who is looking at the calendar, as far as the write path cares. */
export type BookingViewer = { id: string; role: UserRole | null };

/**
 * Mirrors `can_manage_booking()` in the database (migration 6) and
 * `requireBookingAccess()` in the API: the admin manages everything, a PM
 * manages the bookings of the projects they are responsible for.
 *
 * This is the *third* place the rule appears, and that is on purpose but worth
 * naming: the policy is the one that enforces it, the guard exists to answer
 * with a readable 403, and this one decides whether to draw a button. Showing an
 * action that the database will refuse is its own kind of bug — the user finds
 * out they lack permission only after filling in the form.
 */
export function canManageProject(
  viewer: BookingViewer | null,
  project: { pmId: string },
): boolean {
  if (!viewer) return false;
  if (viewer.role === "admin") return true;
  return viewer.role === "pm" && project.pmId === viewer.id;
}

/** Whether the viewer can create bookings at all — drives the primary action. */
export function canCreateBookings(viewer: BookingViewer | null): boolean {
  return viewer?.role === "admin" || viewer?.role === "pm";
}
