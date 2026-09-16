import { EmptyState } from "@/components/empty-state";
import { KanbanBoard } from "@/components/projects/kanban-board";
import type { UserRole } from "@/lib/auth/roles";
import type { SprintListItem } from "@/lib/sprints/query";
import type { TicketListItem } from "@/lib/tickets/query";
import type { Database } from "@/types/database";

import { CreateSprintButton } from "./create-sprint-button";
import { PlannedSprintsList } from "./planned-sprints-list";
import { SprintHeader } from "./sprint-header";

type ProjectRole = Database["public"]["Enums"]["project_member_role"];

/**
 * Contenedor del tab Sprint (018 T4.4). Server-safe (delega en componentes
 * cliente donde hace falta). Tres caminos según el estado del proyecto:
 *
 *   - **Con sprint activo:** header + kanban filtrado a los tickets del
 *     sprint + lista de próximos.
 *   - **Sin activo pero con planificados:** empty state que invita a activar
 *     el próximo + lista de planificados.
 *   - **Sin ninguno:** empty state con CTA "Crear sprint".
 *
 * El header y la lista de planificados son cliente porque tienen dialogs y
 * PATCH; el envoltorio queda server-safe para no arrastrar cliente sin razón.
 */
export function SprintTabContent({
  project,
  viewer,
  roleInProject,
  activeSprint,
  plannedSprints,
  activeSprintTickets,
  ticketCountByPlannedSprintId,
  canManage,
  isPmPrimary,
}: {
  project: { id: string; pmId: string };
  viewer: { id: string; roles: UserRole[] } | null;
  roleInProject: ProjectRole | null;
  activeSprint: SprintListItem | null;
  plannedSprints: SprintListItem[];
  activeSprintTickets: TicketListItem[];
  ticketCountByPlannedSprintId: Record<string, number>;
  canManage: boolean;
  isPmPrimary: boolean;
}) {
  // Sin sprints ni activo ni planificados: empty state completo.
  if (!activeSprint && plannedSprints.length === 0) {
    return (
      <EmptyState
        title="Sin sprints en este proyecto"
        description="Creá un sprint para organizar el trabajo en ventanas de tiempo."
        action={
          canManage ? <CreateSprintButton projectId={project.id} /> : undefined
        }
      />
    );
  }

  // Sin activo pero hay planificados: invitar a activar.
  if (!activeSprint) {
    return (
      <>
        <EmptyState
          title="No hay sprint activo"
          description="Activá el próximo sprint planificado para arrancar el trabajo."
          action={
            canManage ? (
              <CreateSprintButton
                projectId={project.id}
                label="Crear otro sprint"
              />
            ) : undefined
          }
        />
        <PlannedSprintsList
          sprints={plannedSprints}
          hasActiveSprint={false}
          projectId={project.id}
          ticketCountBySprintId={ticketCountByPlannedSprintId}
          canManage={canManage}
        />
      </>
    );
  }

  // Con activo: header + kanban + próximos abajo.
  const nextPlanned = plannedSprints[0] ?? null;

  return (
    <>
      <SprintHeader
        sprint={activeSprint}
        tickets={activeSprintTickets}
        nextPlannedSprint={nextPlanned}
        projectId={project.id}
        canEdit={canManage}
        canClose={isPmPrimary}
      />

      <KanbanBoard
        tickets={activeSprintTickets}
        viewer={viewer}
        project={{ id: project.id, pm_id: project.pmId }}
        roleInProject={roleInProject}
      />

      <PlannedSprintsList
        sprints={plannedSprints}
        hasActiveSprint
        projectId={project.id}
        ticketCountBySprintId={ticketCountByPlannedSprintId}
        canManage={canManage}
      />
    </>
  );
}
