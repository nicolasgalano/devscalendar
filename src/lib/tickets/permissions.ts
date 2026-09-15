import { isAdmin, type UserRole } from "@/lib/auth/roles";
import type { Database } from "@/types/database";

type ProjectRole = Database["public"]["Enums"]["project_member_role"];

/**
 * Quien está mirando el ticket, desde el punto de vista de quién puede editar.
 * El `roleInProject` lo trae la page desde el server (join contra
 * `project_members`); acá vive solo la decisión.
 */
export type TicketViewer = { id: string; roles: UserRole[] };

/**
 * Replica en el cliente la lógica del trigger `enforce_ticket_contributor_scope`
 * (migration 14 §12), **para UX y solo para UX**: dibuja o no un control,
 * habilita o no un dropdown. La verdad la sigue teniendo el server: si esta
 * función se atrasa contra el trigger, el server rechaza igual.
 *
 * Reglas (jerarquía):
 *   - admin, PM del proyecto, o `lead` en el proyecto → hacen todo.
 *   - `contributor` → cambia status de cualquiera, edita solo los propios,
 *     NO reasigna.
 *   - `viewer` o sin membresía → nada (además la RLS los filtra antes).
 *
 * Los tres predicados se exportan aparte para que el UI pueda deshabilitar
 * cada control por su cuenta.
 */

/** admin, PM del proyecto, o lead: los tres tienen control total. */
function hasFullControl(
  viewer: TicketViewer,
  project: { pm_id: string },
  roleInProject: ProjectRole | null,
): boolean {
  return (
    isAdmin(viewer.roles) || project.pm_id === viewer.id || roleInProject === "lead"
  );
}

/** Reasignar el ticket (cambiar `assignee_id`): solo lead+. */
export function canReassignTicket(
  viewer: TicketViewer | null,
  project: { pm_id: string },
  roleInProject: ProjectRole | null,
): boolean {
  if (!viewer) return false;
  return hasFullControl(viewer, project, roleInProject);
}

/**
 * Cambiar el status del ticket: cualquier contributor+, y los `lead`/PM/admin.
 * Diseño explícito del spec (AC-4.2): la transición es colaborativa, no
 * exclusiva del asignado ni del autor.
 */
export function canChangeTicketStatus(
  viewer: TicketViewer | null,
  project: { pm_id: string },
  roleInProject: ProjectRole | null,
): boolean {
  if (!viewer) return false;
  return (
    hasFullControl(viewer, project, roleInProject) ||
    roleInProject === "contributor"
  );
}

/**
 * Editar campos del ticket (`title`, `description`, `priority`): lead+, o
 * `contributor` sobre lo propio (creado o asignado a él).
 */
export function canEditTicketFields(
  viewer: TicketViewer | null,
  ticket: { created_by: string; assignee_id: string | null },
  project: { pm_id: string },
  roleInProject: ProjectRole | null,
): boolean {
  if (!viewer) return false;
  if (hasFullControl(viewer, project, roleInProject)) return true;
  if (roleInProject === "contributor") {
    return ticket.created_by === viewer.id || ticket.assignee_id === viewer.id;
  }
  return false;
}

/**
 * Combinado: alguna operación de edición es posible. Sirve para decidir si
 * mostrar el botón "Editar" — si es `false`, ni siquiera se dibuja.
 */
export function canEditTicket(
  viewer: TicketViewer | null,
  ticket: { created_by: string; assignee_id: string | null },
  project: { pm_id: string },
  roleInProject: ProjectRole | null,
): boolean {
  return (
    canReassignTicket(viewer, project, roleInProject) ||
    canChangeTicketStatus(viewer, project, roleInProject) ||
    canEditTicketFields(viewer, ticket, project, roleInProject)
  );
}
