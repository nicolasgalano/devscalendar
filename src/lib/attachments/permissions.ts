import { isAdmin, type UserRole } from "@/lib/auth/roles";
import { canEditTicketFields, type TicketViewer } from "@/lib/tickets/permissions";
import type { Database } from "@/types/database";

type ProjectRole = Database["public"]["Enums"]["project_member_role"];

/**
 * Permisos de adjuntos de ticket (feature 020). Vive como archivo aparte
 * de `src/lib/tickets/permissions.ts` porque la regla de delete difiere:
 * un contributor NO puede borrar el adjunto de otro aunque el trigger de
 * ticket lo dejara editar el ticket. La regla del delete es identidad del
 * uploader + admin + PM primario.
 *
 * Como siempre, estos helpers son **UX**. La verdad la tiene la RLS de
 * `ticket_attachments` (§2.2 del plan de 020) — si el helper se atrasa
 * respecto a la policy, la policy rechaza igual y el cliente ve un 403.
 */

/**
 * Subir un adjunto a un ticket. Se hereda la regla de `canEditTicketFields`:
 * si el user puede tocar los campos del ticket, puede sumar adjuntos. La
 * RLS de insert es un poco más laxa (deja pasar a cualquier contributor del
 * proyecto, no distingue "propio" vs. "ajeno") pero el UX debe reflejar el
 * mismo umbral que el resto de la edición del ticket para no confundir.
 */
export function canUploadAttachment(
  viewer: TicketViewer | null,
  ticket: { created_by: string; assignee_id: string | null },
  project: { pm_id: string },
  roleInProject: ProjectRole | null,
): boolean {
  return canEditTicketFields(viewer, ticket, project, roleInProject);
}

/**
 * Borrar un adjunto. Distinto a la regla de edit del ticket:
 * - El uploader siempre puede borrar el suyo, aunque hoy no tenga permiso
 *   sobre el ticket (por ejemplo: era contributor, subió el adjunto, y
 *   después le sacaron la membresía — sigue pudiendo limpiar lo suyo).
 * - El PM primario del proyecto puede borrar de otros (moderación).
 * - Admin puede borrar de cualquiera.
 * - Un contributor ajeno NO puede borrar el adjunto de otro.
 *
 * `attachment.uploaded_by` puede ser `null` si el user que subió fue
 * borrado (`on delete set null` en la FK). En ese caso, solo admin y PM
 * pueden borrar — nadie más es "el autor".
 */
export function canDeleteAttachment(
  attachment: { uploaded_by: string | null },
  viewer: { id: string; roles: UserRole[] } | null,
  project: { pm_id: string },
): boolean {
  if (!viewer) return false;
  if (isAdmin(viewer.roles)) return true;
  if (project.pm_id === viewer.id) return true;
  if (attachment.uploaded_by !== null && attachment.uploaded_by === viewer.id) {
    return true;
  }
  return false;
}
