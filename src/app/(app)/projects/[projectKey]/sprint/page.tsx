import { notFound } from "next/navigation";

import { SprintTabContent } from "@/components/projects/sprint-tab-content";
import { isAdmin } from "@/lib/auth/roles";
import { getProjectByKey } from "@/lib/projects/workspace";
import { getActiveSprint, getPlannedSprints } from "@/lib/sprints/query";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/session";
import { getTicketsList } from "@/lib/tickets/query";
import { TICKET_STATUS_ORDER } from "@/lib/tickets/status";

export const dynamic = "force-dynamic";

/**
 * Tab "Sprint" del workspace del proyecto (018 T4.3). Server component.
 * Fetch en cascada: proyecto → sprint activo + planificados → tickets del
 * activo (si hay). Delega el render en `<SprintTabContent>` que decide entre
 * los tres estados (activo / solo planificados / vacío).
 *
 * Los cuatro fetches se hacen en paralelo cuando se pueden — proyecto y
 * profile van primero porque el resto depende del `project.id`.
 */
export default async function SprintPage({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;

  const [project, profile, user] = await Promise.all([
    getProjectByKey(projectKey),
    getCurrentProfile(),
    getCurrentUser(),
  ]);
  if (!project) notFound();

  const [activeSprint, plannedSprints] = await Promise.all([
    getActiveSprint(project.id),
    getPlannedSprints(project.id),
  ]);

  // Tickets del activo — solo si hay activo.
  const activeSprintTickets = activeSprint
    ? await getTicketsList(
        {
          projectId: project.id,
          statuses: [...TICKET_STATUS_ORDER],
          assigneeId: null,
          priorities: [],
          q: null,
          includeClosed: true,
        },
        user?.id ?? null,
        { sprintId: activeSprint.id },
      )
    : [];

  // Contar tickets por sprint planificado — para el rótulo "N tickets" de la
  // lista de próximos. Una sola query agregada evita N round trips.
  const ticketCountByPlannedSprintId: Record<string, number> = {};
  if (plannedSprints.length > 0) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("tickets")
      .select("sprint_id, id.count()")
      .in(
        "sprint_id",
        plannedSprints.map((sprint) => sprint.id),
      );
    for (const row of (data ?? []) as unknown as Array<{
      sprint_id: string;
      count: number;
    }>) {
      ticketCountByPlannedSprintId[row.sprint_id] = row.count;
    }
  }

  const canManage = Boolean(
    profile && (isAdmin(profile.roles) || project.pm?.id === profile.id),
  );
  const isPmPrimary = Boolean(profile && project.pm?.id === profile.id);

  return (
    <SprintTabContent
      project={{ id: project.id, pmId: project.pm?.id ?? "" }}
      viewer={profile ? { id: profile.id, roles: profile.roles } : null}
      roleInProject={project.roleInProject}
      activeSprint={activeSprint}
      plannedSprints={plannedSprints}
      activeSprintTickets={activeSprintTickets}
      ticketCountByPlannedSprintId={ticketCountByPlannedSprintId}
      canManage={canManage}
      isPmPrimary={isPmPrimary}
    />
  );
}
