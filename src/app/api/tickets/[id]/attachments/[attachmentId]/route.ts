import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

import { requireTicketAccess } from "@/lib/api/require-ticket-access";
import { canDeleteAttachment } from "@/lib/attachments/permissions";
import { ATTACHMENT_BUCKET } from "@/lib/attachments/types";
import { getCurrentProfile } from "@/lib/supabase/session";
import type { Database } from "@/types/database";

/**
 * DELETE /api/tickets/[id]/attachments/[attachmentId]
 *
 * Borra el adjunto: primero los dos objetos del bucket, después la fila de
 * `ticket_attachments`. El trigger `audit_ticket_attachment_events` graba
 * el snapshot completo antes de que la fila se vaya.
 *
 * Orden intencional (§3.3 del plan):
 *   - Si el remove de storage falla, la fila queda y el user reintenta. La
 *     RLS de la próxima petición sigue autorizando (el estado no cambió).
 *   - Si el remove de storage OK y el delete de la fila falla, quedan
 *     objetos huérfanos sin fila. Edge case aceptado — cleanup job futuro
 *     lo puede barrer (F4 de tasks.md).
 *
 * Permisos: la RLS de delete acepta autor + PM primario + admin. Este
 * handler chequea lo mismo antes con `canDeleteAttachment` para responder
 * 403 con motivo legible en vez del "no rows deleted" silencioso.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { id: ticketId, attachmentId } = await params;

  const guard = await requireTicketAccess(ticketId);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Traer la fila para conocer los paths + validar permisos + confirmar que
  // pertenece al ticket.
  const { data: attachment } = await supabase
    .from("ticket_attachments")
    .select("id, ticket_id, project_id, uploaded_by, object_key, thumb_object_key")
    .eq("id", attachmentId)
    .maybeSingle();

  if (!attachment || attachment.ticket_id !== ticketId) {
    return NextResponse.json({ error: "Adjunto no encontrado" }, { status: 404 });
  }

  // Necesitamos `project.pm_id` para el chequeo de moderación.
  const { data: project } = await supabase
    .from("projects")
    .select("pm_id")
    .eq("id", attachment.project_id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  const viewer = { id: profile.id, roles: profile.roles };
  if (!canDeleteAttachment(attachment, viewer, { pm_id: project.pm_id })) {
    return NextResponse.json(
      { error: "No tenés permiso para borrar este adjunto" },
      { status: 403 },
    );
  }

  // 1. Borrar los dos objetos del bucket con service_role. `remove` acepta
  //    array — si alguno de los dos no existe, `remove` lo ignora (no tira).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Falta configuración del servidor" }, { status: 500 });
  }
  const admin = createServiceClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const removeResult = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .remove([attachment.object_key, attachment.thumb_object_key]);

  if (removeResult.error) {
    // Fila queda. El user reintenta.
    return NextResponse.json(
      {
        error: "No se pudo borrar el archivo del storage",
        detail: removeResult.error.message,
      },
      { status: 500 },
    );
  }

  // 2. Borrar la fila. La RLS acepta si el user cumple la condición
  //    (redundante con el `canDeleteAttachment` de arriba, pero es la
  //    garantía final).
  const { error: deleteError } = await supabase
    .from("ticket_attachments")
    .delete()
    .eq("id", attachmentId);

  if (deleteError) {
    // Los objetos ya se borraron — la fila queda huérfana. Se loguea para
    // que el cleanup job futuro (F4) lo detecte.
    console.error(
      "[020 DELETE] Objetos borrados pero DELETE de la fila falló — huérfano:",
      attachmentId,
      deleteError.message,
    );
    return NextResponse.json(
      { error: "No se pudo completar el borrado", detail: deleteError.message },
      { status: 500 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
