import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

import { canUploadAttachment } from "@/lib/attachments/permissions";
import {
  ATTACHMENT_BUCKET,
  buildObjectKey,
  isAttachmentMimeType,
  isImageMime,
  type AttachmentMimeType,
} from "@/lib/attachments/types";
import { requireTicketAccess } from "@/lib/api/require-ticket-access";
import { getCurrentProfile } from "@/lib/supabase/session";
import { parseAttachmentUploadForm } from "@/lib/validation/attachments";
import type { Database } from "@/types/database";

type TicketAttachmentInsert = Database["public"]["Tables"]["ticket_attachments"]["Insert"];
type ProjectRole = Database["public"]["Enums"]["project_member_role"];

/**
 * POST /api/tickets/[id]/attachments
 *
 * Recibe un multipart con dos archivos (original + thumb generado en cliente)
 * y sus dimensiones. Valida MIME/tamaño (defensa en profundidad — el cliente
 * ya validó), sube ambos objetos al bucket privado `ticket-attachments` con
 * service_role, y crea la fila en `ticket_attachments`.
 *
 * Orden del pipeline (§3.1 del plan):
 *
 *   1. Guard del ticket (RLS respeta lo que el user puede ver).
 *   2. Guard fino con `canUploadAttachment` — mismo umbral que edit de campos
 *      del ticket. La RLS de insert deja pasar a cualquier contributor+; el
 *      handler la refina.
 *   3. Parseo y validación del multipart.
 *   4. Generación de UUIDs y `object_key`/`thumb_object_key`.
 *   5. Upload al bucket (service_role — el cliente authenticated no tiene
 *      grants sobre el bucket para writes).
 *   6. Insert de la fila.
 *   7. Si algo falla después del upload, se intenta borrar los objetos
 *      subidos (best-effort, sin bloquear la respuesta si el remove falla).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: ticketId } = await params;

  // 1. Guard del ticket + membresía del proyecto.
  const guard = await requireTicketAccess(ticketId);
  if (!guard.ok) return guard.response;
  const { ticket, supabase, role: grantedRole } = guard;

  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // 2. Cargar project.pm_id + `active` para el check de permisos y proyecto.
  const { data: project } = await supabase
    .from("projects")
    .select("id, pm_id, active")
    .eq("id", ticket.project_id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!project.active) {
    return NextResponse.json({ error: "Ese proyecto está desactivado" }, { status: 409 });
  }

  const viewer = { id: profile.id, roles: profile.roles };
  // Mapeo del rol otorgado al `roleInProject` que espera
  // `canUploadAttachment`. Cuando el guard es admin o PM primario, el rol
  // dentro del proyecto es indistinto (hasFullControl los cubre); se pasa
  // null. Cuando es viewer/contributor/lead, se pasa tal cual.
  const roleInProject: ProjectRole | null =
    grantedRole === "admin" || grantedRole === "pm" ? null : grantedRole;

  const canUpload = canUploadAttachment(
    viewer,
    { created_by: ticket.created_by, assignee_id: ticket.assignee_id },
    { pm_id: project.pm_id },
    roleInProject,
  );
  if (!canUpload) {
    return NextResponse.json(
      { error: "No tenés permiso para adjuntar archivos a este ticket" },
      { status: 403 },
    );
  }

  // 3. Parseo del multipart.
  const parsed = await parseAttachmentUploadForm(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.issues },
      { status: 400 },
    );
  }
  const { original, thumb, width, height } = parsed.data;

  // El MIME ya vino validado por `parseAttachmentUploadForm` contra la
  // whitelist. Repetimos el narrowing acá para tipar `originalMime` como
  // `AttachmentMimeType` — el `File.type` es `string`.
  if (!isAttachmentMimeType(original.type)) {
    return NextResponse.json(
      { error: "Tipo de archivo no permitido" },
      { status: 415 },
    );
  }
  const originalMime: AttachmentMimeType = original.type;
  const isImage = isImageMime(originalMime);

  // Para imágenes el validador ya exige thumb/width/height; defensivamente
  // reconfirmamos acá (una invariante del contrato de 020 que 025 mantiene).
  if (isImage && (!thumb || width === undefined || height === undefined)) {
    return NextResponse.json(
      { error: "Faltan campos obligatorios del thumbnail" },
      { status: 400 },
    );
  }

  // 4. IDs y paths en el bucket. `thumbObjectKey` es null para no-imagen —
  //    los PDFs y docs no tienen thumb (025).
  const attachmentId = randomUUID();
  const { objectKey, thumbObjectKey } = buildObjectKey(
    ticket.id,
    attachmentId,
    original.name,
    originalMime,
  );

  // 5. Upload al bucket con service_role.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Falta configuración del servidor" }, { status: 500 });
  }
  const admin = createServiceClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const originalUpload = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .upload(objectKey, original, {
      contentType: originalMime,
      upsert: false,
    });

  if (originalUpload.error) {
    return NextResponse.json(
      { error: "No se pudo subir el archivo original", detail: originalUpload.error.message },
      { status: 500 },
    );
  }

  // Thumb solo para imágenes (020). Los no-imagen (PDFs, docs de 025) no
  // envían thumb y el handler no sube nada en este paso.
  if (isImage && thumbObjectKey && thumb) {
    const thumbUpload = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .upload(thumbObjectKey, thumb, {
        contentType: thumb.type,
        upsert: false,
      });

    if (thumbUpload.error) {
      // Cleanup del original — best effort.
      await admin.storage.from(ATTACHMENT_BUCKET).remove([objectKey]).catch(() => undefined);
      return NextResponse.json(
        { error: "No se pudo subir el thumbnail", detail: thumbUpload.error.message },
        { status: 500 },
      );
    }
  }

  // 6. Insert de la fila con el cliente authenticated. La RLS de insert de
  //    `ticket_attachments` corre como garantía final: aunque el handler ya
  //    validó, si algo cambió (la membresía se revocó entre el guard y el
  //    insert) la policy rechaza.
  //
  //    Las columnas `thumb_object_key`, `width`, `height` son nullable desde
  //    la migration 23 (025). Para no-imagen van `null`.
  const insertPayload: TicketAttachmentInsert = {
    id: attachmentId,
    ticket_id: ticket.id,
    project_id: ticket.project_id,
    object_key: objectKey,
    thumb_object_key: thumbObjectKey,
    original_filename: original.name,
    mime_type: originalMime,
    size_bytes: original.size,
    width: isImage ? width ?? null : null,
    height: isImage ? height ?? null : null,
    uploaded_by: viewer.id,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("ticket_attachments")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertError || !inserted) {
    // Cleanup de los objetos si el insert falló (Q-5 del plan de 020). Para
    // no-imagen solo hay `objectKey`; para imagen están los dos.
    const toRemove = thumbObjectKey ? [objectKey, thumbObjectKey] : [objectKey];
    await admin.storage
      .from(ATTACHMENT_BUCKET)
      .remove(toRemove)
      .catch(() => undefined);
    return NextResponse.json(
      {
        error: "No se pudo registrar el adjunto",
        detail: insertError?.message ?? "insert sin fila devuelta",
      },
      { status: 500 },
    );
  }

  return NextResponse.json(inserted, { status: 201 });
}
