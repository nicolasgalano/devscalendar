import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { CapacityPlanningView } from "@/components/planning/capacity-planning-view";
import { addDays } from "@/lib/calendar/range";
import { getAllPlanningData } from "@/lib/planning/capacity";
import {
  getCapacityWeekBounds,
  getCapacityWeekBoundsFromStart,
} from "@/lib/planning/range";
import { parsePlanningUrl } from "@/lib/planning/url";
import { getVisibleProjects } from "@/lib/projects/workspace";
import { getCurrentProfile } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Feature 029: planificación de capacidad.
 *
 * Modo default: todos los proyectos activos visibles al usuario, agrupados
 * cliente > proyecto > dev. El dropdown del toolbar filtra opcionalmente a
 * un solo proyecto.
 *
 * El selector solo muestra proyectos activos (R-9 del plan): sobre un
 * inactivo el upsert devolvería DC004.
 */
export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const raw = await searchParams;
  const url = parsePlanningUrl(new URLSearchParams(raw));

  const profile = await getCurrentProfile();
  if (!profile) {
    return (
      <>
        <PageHeader title="Planificación" />
        <EmptyState
          title="Sesión no disponible"
          description="Volvé a iniciar sesión para ver la planificación."
        />
      </>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const { weekStart, days } = url.w
    ? getCapacityWeekBoundsFromStart(url.w)
    : getCapacityWeekBounds(today);

  const dateFrom = days[0]!;
  const dateToExclusive = addDays(days[days.length - 1]!, 1);

  const [allVisibleProjects, planningData] = await Promise.all([
    getVisibleProjects(),
    getAllPlanningData(dateFrom, dateToExclusive),
  ]);

  const activeProjects = allVisibleProjects.filter((p) => p.active);

  // Filtro por proyecto en el dropdown: si `url.project` matchea un proyecto
  // activo visible, nos quedamos solo con esas rows. Si no, mantenemos todo.
  const selectedProject = url.project
    ? activeProjects.find((p) => p.key === url.project) ?? null
    : null;

  const filteredRows = selectedProject
    ? planningData.rows.filter((row) => row.project.id === selectedProject.id)
    : planningData.rows;
  const filteredEstimates = selectedProject
    ? planningData.estimates.filter((e) => e.projectId === selectedProject.id)
    : planningData.estimates;

  return (
    <>
      <PageHeader
        title="Planificación"
        description={
          selectedProject
            ? `Capacidad estimada por día para ${selectedProject.name}.`
            : "Capacidad estimada por día de todos los proyectos activos."
        }
      />
      <CapacityPlanningView
        projects={activeProjects}
        selectedProjectKey={selectedProject?.key ?? null}
        rows={filteredRows}
        estimates={filteredEstimates}
        canEditByProject={planningData.canEditByProject}
        days={days}
        weekStart={weekStart}
        currentUserId={profile.id}
        urlState={url}
      />
    </>
  );
}
