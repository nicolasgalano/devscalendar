import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { CapacityPlanningView } from "@/components/planning/capacity-planning-view";
import { isAdmin } from "@/lib/auth/roles";
import {
  getPlanningDevs,
  getProjectCapacityEstimates,
} from "@/lib/planning/capacity";
import {
  getCapacityWeekBounds,
  getCapacityWeekBoundsFromStart,
} from "@/lib/planning/range";
import { parsePlanningUrl } from "@/lib/planning/url";
import { addDays } from "@/lib/calendar/range";
import { getProjectByKey, getVisibleProjects } from "@/lib/projects/workspace";
import { getCurrentProfile } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Feature 029: planificación de capacidad por proyecto. Pantalla global
 * con selector de proyecto arriba y grilla 4 semanas × devs del proyecto.
 *
 * El selector solo muestra proyectos **activos** (R-9 del plan): un
 * proyecto inactivo no acepta estimaciones nuevas (upsert → DC004), así
 * que ofrecerlo es un callejón sin salida.
 */
export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const raw = await searchParams;
  const url = parsePlanningUrl(new URLSearchParams(raw));

  const [profile, allVisibleProjects] = await Promise.all([
    getCurrentProfile(),
    getVisibleProjects(),
  ]);

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

  // Solo activos — R-9. Un desactivado no se puede editar y confundiría
  // al PM que lo eligiera.
  const activeProjects = allVisibleProjects.filter((p) => p.active);

  // Si la URL trae un project que no es visible/activo, se ignora y la
  // grilla cae al EmptyState — mismo criterio que un filtro inválido en
  // /calendar.
  const project =
    url.project && activeProjects.some((p) => p.key === url.project)
      ? await getProjectByKey(url.project)
      : null;

  if (!project || !project.active) {
    return (
      <>
        <PageHeader
          title="Planificación"
          description="Elegí un proyecto para ver y cargar su capacidad estimada por día."
        />
        <CapacityPlanningView
          projects={activeProjects}
          project={null}
          devs={[]}
          estimates={[]}
          days={[]}
          weekStart={null}
          canEdit={false}
          currentUserId={profile.id}
          urlState={url}
        />
      </>
    );
  }

  // Fecha "hoy" del server. Si el viewer está en otra TZ, el ancla puede
  // caer un día antes/después — aceptable: la navegación con las flechas
  // compensa, y el back/forward del browser preserva el `?w=` del usuario.
  const today = new Date().toISOString().slice(0, 10);
  const { weekStart, days } = url.w
    ? getCapacityWeekBoundsFromStart(url.w)
    : getCapacityWeekBounds(today);

  // Rango semi-abierto [from, to) — days[0] inclusive, siguiente al último
  // día exclusivo.
  const dateFrom = days[0]!;
  const dateToExclusive = addDays(days[days.length - 1]!, 1);

  const estimates = await getProjectCapacityEstimates(project.id, dateFrom, dateToExclusive);
  const devs = await getPlanningDevs(project.id, project.pm?.id ?? profile.id, estimates);

  const canEdit = isAdmin(profile.roles) || project.pm?.id === profile.id;

  return (
    <>
      <PageHeader
        title="Planificación"
        description={`Capacidad estimada por día para ${project.name}.`}
      />
      <CapacityPlanningView
        projects={activeProjects}
        project={project}
        devs={devs}
        estimates={estimates}
        days={days}
        weekStart={weekStart}
        canEdit={canEdit}
        currentUserId={profile.id}
        urlState={url}
      />
    </>
  );
}
