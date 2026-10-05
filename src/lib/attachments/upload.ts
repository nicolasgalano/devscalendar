import { generateThumb } from "./generate-thumb";
import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  isAttachmentMimeType,
} from "./types";
import type { Database } from "@/types/database";

/**
 * DTO que devuelve el POST /api/tickets/:id/attachments (§3.1 del plan).
 * Es una fila de `ticket_attachments` tal cual sale del DB — el `signed_url`
 * NO está incluido y hay que pedirlo aparte.
 */
export type AttachmentDTO = Database["public"]["Tables"]["ticket_attachments"]["Row"];

export type UploadResult = { ok: true; attachment: AttachmentDTO } | {
  ok: false;
  error: string;
};

/**
 * Sube un adjunto al ticket:
 *   1. Valida MIME + tamaño client-side (rebota antes de meter tráfico).
 *   2. Genera el thumb con Canvas.
 *   3. Arma un multipart con original + thumb + width + height.
 *   4. POST al endpoint del ticket.
 *
 * Devuelve un resultado tagged en vez de tirar para que el llamador maneje
 * el estado por archivo sin `try/catch` — típico en batches de uploads en
 * paralelo (cada uno tiene su placeholder).
 *
 * **No hay progreso porcentual** — `fetch` no expone `progress` para
 * uploads. Si aparece la necesidad, se cambia a XHR (F1 de tasks.md).
 */
export async function uploadTicketAttachment(
  ticketId: string,
  file: File,
): Promise<UploadResult> {
  // Validación client-side.
  if (!isAttachmentMimeType(file.type)) {
    return {
      ok: false,
      error: `Tipo no permitido. Aceptados: ${ATTACHMENT_MIME_TYPES.join(", ")}`,
    };
  }
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false,
      error: `El archivo pasa el límite de ${MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024} MB`,
    };
  }
  if (file.size === 0) {
    return { ok: false, error: "El archivo está vacío" };
  }

  // Thumb.
  let thumb;
  try {
    thumb = await generateThumb(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo generar el thumbnail";
    return { ok: false, error: message };
  }

  // Multipart. `FormData` acepta File y Blob; el segundo argumento es el
  // filename que llega al server. Le damos al thumb un nombre derivado del
  // original con extensión `.webp` para que el `original_filename` del
  // original no se pise si un cliente confunde los fields.
  const form = new FormData();
  form.append("original", file, file.name);
  form.append("thumb", thumb.blob, `${file.name}.webp`);
  form.append("width", String(thumb.width));
  form.append("height", String(thumb.height));

  let response: Response;
  try {
    response = await fetch(`/api/tickets/${ticketId}/attachments`, {
      method: "POST",
      body: form,
    });
  } catch {
    return { ok: false, error: "No se pudo conectar con el servidor" };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      issues?: Record<string, string[]>;
    };
    // Si vino `issues`, aplano el primero para mostrar algo concreto.
    const firstIssue = body.issues
      ? Object.values(body.issues).flat()[0]
      : undefined;
    return {
      ok: false,
      error: firstIssue ?? body.error ?? `Error ${response.status}`,
    };
  }

  const attachment = (await response.json()) as AttachmentDTO;
  return { ok: true, attachment };
}

/**
 * Pide una signed URL al server para un adjunto. Se usa desde el
 * `<ThumbnailCard>` on mount para pintar el thumb, y desde el `<Lightbox>`
 * para cargar el original.
 */
export async function fetchAttachmentSignedUrl(
  ticketId: string,
  attachmentId: string,
  variant: "thumb" | "original" = "thumb",
): Promise<string | null> {
  try {
    const response = await fetch(
      `/api/tickets/${ticketId}/attachments/${attachmentId}/signed-url?variant=${variant}`,
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { url?: string };
    return body.url ?? null;
  } catch {
    return null;
  }
}

/**
 * Borra un adjunto. Devuelve `true` si el server confirmó (204), `false` si
 * respondió cualquier otro código.
 */
export async function deleteTicketAttachment(
  ticketId: string,
  attachmentId: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/tickets/${ticketId}/attachments/${attachmentId}`,
      { method: "DELETE" },
    );
    return response.ok;
  } catch {
    return false;
  }
}
