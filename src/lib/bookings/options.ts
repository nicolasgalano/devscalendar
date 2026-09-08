import type { SupabaseClient } from "@supabase/supabase-js";

import { isAdmin } from "@/lib/auth/roles";
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

  // El admin ve todos los proyectos activos; el PM, los suyos. Con roles
  // múltiples el orden importa: quien es PM *y* admin ve todos, porque admin es
  // superconjunto de pm para operar reservas (D-09).
  if (!isAdmin(viewer!.roles)) projectsQuery = projectsQuery.eq("pm_id", viewer!.id);

  const [projects, devs] = await Promise.all([
    projectsQuery,
    supabase
      .from("profiles")
      .select("id, full_name, email, primary_pm_id")
      .contains("roles", ["developer"])
      .eq("active", true),
  ]);

  if (projects.error) throw projects.error;
  if (devs.error) throw devs.error;

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "es");

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
    //
    // Alfabético primero y recién después el reagrupado por PM primario: el
    // orden dentro de cada grupo tiene que seguir siendo el de siempre.
    devs: sortDevsByPrimaryPm(
      (devs.data ?? [])
        .map((dev) => ({
          id: dev.id,
          name: dev.full_name ?? dev.email,
          primaryPmId: dev.primary_pm_id,
        }))
        .sort(byName),
      { id: viewer!.id, isAdmin: isAdmin(viewer!.roles) },
    ).map(({ id, name }) => ({ id, name })),
  };
}

/**
 * D-03 / AC-3.2 de `002`: el desarrollador que tiene a este PM como PM primario
 * es su **candidato natural**, así que va primero.
 *
 * **Es un orden y no un filtro**, y esa es la mitad que importa: el AC dice
 * "candidato natural", no "único candidato". Q-B ya está respondida —el dev es
 * transversal— así que esconder a los demás sería contradecirla. Cada grupo
 * conserva el orden alfabético con el que llega.
 *
 * **Al admin no se le reordena** (AC-2.2): no tiene devs propios, y una lista
 * cuyo orden cambia según quién mira, sin que nada lo anuncie, es peor que la
 * alfabética de siempre.
 */
export function sortDevsByPrimaryPm<T extends { primaryPmId: string | null }>(
  devs: T[],
  viewer: { id: string; isAdmin: boolean },
): T[] {
  if (viewer.isAdmin) return devs;
  return [
    ...devs.filter((dev) => dev.primaryPmId === viewer.id),
    ...devs.filter((dev) => dev.primaryPmId !== viewer.id),
  ];
}
