import { generateThumb } from "./generate-thumb";
import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  isAttachmentMimeType,
  isImageMime,
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
 *   2. **Solo si es imagen** (020): genera el thumb WebP con Canvas y lo
 *      agrega al multipart junto con las dimensiones. Para no-imagen (PDF,
 *      Word, Excel — 025) saltea `generateThumb` — el panel renderiza
 *      ícono por tipo en vez de thumbnail.
 *   3. POST al endpoint del ticket.
 *
 * Devuelve un resultado tagged en vez de tirar para que el llamador maneje
 * el estado por archivo sin `try/catch` — típico en batches de uploads en
 * paralelo (cada uno tiene su placeholder).
 *
 * **No hay progreso porcentual** — `fetch` no expone `progress` para
 * uploads. Si aparece la necesidad, se cambia a XHR (F1 del plan de 020).
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

  const form = new FormData();
  form.append("original", file, file.name);

  // Thumb solo para imágenes. Las docs/PDFs del 025 no tienen thumb — el
  // panel renderiza ícono por tipo.
  if (isImageMime(file.type)) {
    let thumb;
    try {
      thumb = await generateThumb(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo generar el thumbnail";
      return { ok: false, error: message };
    }
    // El segundo argumento del append es el filename que llega al server.
    // Al thumb le damos un nombre derivado del original con extensión
    // `.webp` para que el `original_filename` del original no se pise si
    // un cliente confunde los fields.
    form.append("thumb", thumb.blob, `${file.name}.webp`);
    form.append("width", String(thumb.width));
    form.append("height", String(thumb.height));
  }

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
 * Pide una signed URL al server para un adjunto. Se usa desde:
 *   - `<ThumbnailCard>` on mount → thumb (default).
 *   - `<Lightbox>` → variant=original para preview inline.
 *   - `<DocumentCard>` (025) → variant=original + download=true para
 *     disparar la descarga nativa del browser.
 *
 * El flag `options.download` agrega `?download=1` al query, que hace que
 * el server pida a Supabase Storage firmar la URL con el flag `download:
 * originalFilename` — Supabase devuelve el archivo con
 * `Content-Disposition: attachment` y el browser lo descarga sin renderizar
 * inline (crítico para PDFs y docs).
 */
export async function fetchAttachmentSignedUrl(
  ticketId: string,
  attachmentId: string,
  variant: "thumb" | "original" = "thumb",
  options?: { download?: boolean },
): Promise<string | null> {
  try {
    const params = new URLSearchParams({ variant });
    if (options?.download) params.set("download", "1");
    const response = await fetch(
      `/api/tickets/${ticketId}/attachments/${attachmentId}/signed-url?${params.toString()}`,
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
