import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProjectPriority } from "@/lib/validation/calendar";
import type { Database } from "@/types/database";

import { canCreateBookings, type BookingViewer } from "./permissions";

type Client = SupabaseClient<Database>;

export type BookingFormOptions = {
  projects: {
    id: string;
    name: string;
    clientName: string;
    priority: ProjectPriority;
  }[];
  devs: { id: string; name: string }[];
};

export const NO_BOOKING_OPTIONS: BookingFormOptions = { projects: [], devs: [] };

/**
 * What the booking dialog can offer: the projects this person may book on, and
 * the developers they may book.
 *
 * Scoped to the viewer rather than filtered in the browser — a PM's select
 * listing every project in the company would be a list of things that answer
 * 403. The admin gets all of them, which is the same rule as the policy.
 *
 * Inactive projects and deactivated developers are left out: `002` chose
 * deactivation over deletion precisely so that past bookings keep rendering, and
 * that is a reason to keep showing them in the grid, not to keep offering them
 * for new work.
 */
export async function getBookingFormOptions(
  supabase: Client,
  viewer: BookingViewer | null,
): Promise<BookingFormOptions> {
  if (!canCreateBookings(viewer)) return NO_BOOKING_OPTIONS;

  let projectsQuery = supabase
    .from("projects")
    .select("id, name, priority, client:clients!inner (name)")
    .eq("active", true);

  if (viewer!.role === "pm") projectsQuery = projectsQuery.eq("pm_id", viewer!.id);

  const [projects, devs] = await Promise.all([
    projectsQuery,
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "developer")
      .eq("active", true),
  ]);

  if (projects.error) throw projects.error;
  if (devs.error) throw devs.error;

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, "es");

  return {
    projects: (projects.data ?? [])
      .map((project) => ({
        id: project.id,
        name: project.name,
        clientName: project.client.name,
        priority: project.priority as ProjectPriority,
      }))
      .sort(byName),
    // Same fallback as the calendar: a teammate who signed in with Google and
    // has no display name yet is still bookable, by email.
    devs: (devs.data ?? [])
      .map((dev) => ({ id: dev.id, name: dev.full_name ?? dev.email }))
      .sort(byName),
  };
}
