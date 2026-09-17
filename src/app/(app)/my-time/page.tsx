import { PageHeader } from "@/components/page-header";
import { WeeklyGridView } from "@/components/time-entries/weekly-grid-view";
import type {
  TimeEntryActivity,
  TimeEntryTicket,
} from "@/components/time-entries/time-entry-dialog";
import { hasPmScope } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import {
  getMyLoggableProjects,
  getTimeEntriesForWeek,
} from "@/lib/time-entries/query";
import { getWeekDays, parseWeekParam } from "@/lib/time-entries/week";

export const dynamic = "force-dynamic";

/**
 * "Mi Tiempo" (016 T4.2). Server component que arma la grilla semanal.
 *
 * Data que fetchea:
 *   - Profile del viewer (para permisos).
 *   - Semana (parseada de `?w=`).
 *   - `?userId=` opcional para ver la semana de otra persona (solo si
 *     hasPmScope(viewer)).
 *   - Entries del user seleccionado en el rango de la semana.
 *   - Proyectos donde el user puede cargar (para el dialog).
 *   - Actividades activas por proyecto (para el dialog).
 *   - Tickets abiertos por proyecto (para el autocomplete opcional del dialog).
 *   - Lista de asignables (si aplica) para el selector de user.
 */
export default async function MyTimePage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string; userId?: string }>;
}) {
  const raw = await searchParams;

  const profile = await getCurrentProfile();
  if (!profile) return null;

  const weekStart = parseWeekParam(raw.w);
  const days = getWeekDays(weekStart);
  const weekEnd = days[6]!;

  const canViewOthers = hasPmScope(profile.roles);
  const viewingUserId = canViewOthers && raw.userId ? raw.userId : profile.id;

  const supabase = await createClient();

  // Fetch entries + projects loggeables + assignees (si aplica).
  const [entries, projects, assignees, viewingUserProfile] = await Promise.all([
    getTimeEntriesForWeek(viewingUserId, weekStart, weekEnd),
    getMyLoggableProjects(),
    canViewOthers
      ? supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("active", true)
          .order("full_name", { ascending: true })
          .then((res) => res.data ?? [])
      : Promise.resolve([]),
    viewingUserId === profile.id
      ? Promise.resolve({ id: profile.id, full_name: profile.full_name, email: profile.email })
      : supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("id", viewingUserId)
          .maybeSingle()
          .then((res) => res.data),
  ]);

  const viewingUserName =
    viewingUserProfile?.full_name ?? viewingUserProfile?.email ?? viewingUserId;

  // Actividades y tickets por proyecto: dos queries agregadas sobre los
  // proyectos del user. Al volumen esperado (< 20 proyectos, < 200 activities
  // en total), es aceptable.
  const projectIds = projects.map((p) => p.id);
  const activitiesByProject: Record<string, TimeEntryActivity[]> = {};
  const ticketsByProject: Record<string, TimeEntryTicket[]> = {};
  if (projectIds.length > 0) {
    const [activitiesRes, ticketsRes] = await Promise.all([
      supabase
        .from("project_activities")
        .select("id, project_id, name, active")
        .in("project_id", projectIds)
        .eq("active", true)
        .order("name", { ascending: true }),
      supabase
        .from("tickets")
        .select("id, project_id, numero, title, project:projects!inner ( key )")
        .in("project_id", projectIds)
        .not("status", "in", "(done,cancelled)")
        .order("numero", { ascending: false })
        .limit(200), // hard cap para no explotar el dialog
    ]);
    for (const row of activitiesRes.data ?? []) {
      (activitiesByProject[row.project_id] ??= []).push({
        id: row.id,
        name: row.name,
        active: row.active,
      });
    }
    for (const row of (ticketsRes.data ?? []) as unknown as Array<{
      id: string;
      project_id: string;
      numero: number;
      title: string;
      project: { key: string };
    }>) {
      (ticketsByProject[row.project_id] ??= []).push({
        id: row.id,
        key: `${row.project.key}-${row.numero}`,
        title: row.title,
      });
    }
  }

  return (
    <>
      <PageHeader
        title="Mi tiempo"
        description="Cargá las horas de la semana."
      />
      <WeeklyGridView
        weekStart={weekStart}
        entries={entries}
        viewer={{ id: profile.id, roles: profile.roles }}
        viewingUserId={viewingUserId}
        viewingUserName={viewingUserName}
        assignees={assignees.map((a) => ({
          id: a.id,
          name: a.full_name ?? a.email,
        }))}
        projects={projects}
        activitiesByProject={activitiesByProject}
        ticketsByProject={ticketsByProject}
      />
    </>
  );
}
