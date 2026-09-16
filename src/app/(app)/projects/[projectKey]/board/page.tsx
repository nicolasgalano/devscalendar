import { notFound } from "next/navigation";

import { KanbanBoard } from "@/components/projects/kanban-board";
import { getProjectByKey } from "@/lib/projects/workspace";
import { getTicketsList } from "@/lib/tickets/query";
import { TICKET_STATUS_ORDER } from "@/lib/tickets/status";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Tab "Tablero" del workspace del proyecto (feature 017 T3.5). Server component.
 * Trae todos los tickets del proyecto (los seis estados, no solo los abiertos)
 * y los pasa al `<KanbanBoard>` cliente. El header del layout ya renderizó los
 * datos del proyecto y las tabs.
 */
export default async function BoardPage({
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

  // Traemos los seis estados: el tablero muestra los seis siempre visibles
  // (decisión del cuestionario). El listado global usa `TICKET_STATUS_OPEN`
  // por default; acá pasamos el enum completo.
  const tickets = await getTicketsList(
    {
      projectId: project.id,
      statuses: [...TICKET_STATUS_ORDER],
      assigneeId: null,
      priorities: [],
      q: null,
      includeClosed: true,
    },
    user?.id ?? null,
  );

  return (
    <KanbanBoard
      tickets={tickets}
      viewer={profile ? { id: profile.id, roles: profile.roles } : null}
      project={{ id: project.id, pm_id: project.pm?.id ?? "" }}
      roleInProject={project.roleInProject}
    />
  );
}
