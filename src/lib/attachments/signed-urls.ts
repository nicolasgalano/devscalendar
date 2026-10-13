// Helper server-side que, dado un ticket y un conjunto de attachment ids,
// trae las filas correspondientes y pre-firma la URL del thumbnail en batch.
// El renderer del rich text server-side (`render.ts`) necesita todas las URLs
// resueltas antes de emitir HTML (no es async), así que la page lo invoca una
// vez con los ids extraídos del doc (`extract-attachment-ids.ts`) y le pasa
// el map al viewer.
//
// Diseño:
//
//   - **Filtro por `ticket_id`** en el SELECT. Si un atacante inyecta en el
//     doc un `attachment_id` de otro ticket, la query no lo trae y el renderer
//     emite "imagen no disponible" — cierra el vector cross-tenant descrito
//     en R-3 del spec de 026 sin ningún trigger de validación.
//   - **Firma en paralelo** con `Promise.all` sobre los `thumb_object_key`.
//     Es una llamada por attachment al API de Supabase Storage (no es DB
//     query), y no se pueden batchear a nivel storage — pero las 10 que
//     puede traer un ticket salen en paralelo.
//   - **Falla silenciosa por attachment**: si una signed URL no se puede
//     generar (bucket corrupto, policy raro), ese attachment queda en el map
//     con `signedThumbnailUrl: null`. El renderer lo renderiza como
//     placeholder "imagen no disponible" en vez de reventar el detalle entero.
//   - **Solo imágenes** por ahora. Los docs de 025 no tienen `thumb_object_key`
//     y no se emiten como nodo `image` en el doc; esta función ignora los
//     ids que correspondan a no-imagen (devuelve el map sin esa entry).

import type { SupabaseClient } from "@supabase/supabase-js";

import { ATTACHMENT_BUCKET, isImageMime } from "./types";
import type { Database } from "@/types/database";

const SIGN_EXPIRES_SECONDS = 15 * 60; // mismo horizonte que signed-url route

export type DocAttachment = {
  id: string;
  ticketId: string;
  mimeType: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  signedThumbnailUrl: string | null;
};

export async function getDocAttachments(
  supabase: SupabaseClient<Database>,
  ticketId: string,
  attachmentIds: readonly string[],
): Promise<Map<string, DocAttachment>> {
  const result = new Map<string, DocAttachment>();
  if (attachmentIds.length === 0) return result;

  // Dedupe defensivo — el walker ya devuelve único, pero no cuesta nada.
  const uniqueIds = Array.from(new Set(attachmentIds));

  const { data: rows } = await supabase
    .from("ticket_attachments")
    .select("id, ticket_id, mime_type, original_filename, thumb_object_key, width, height")
    .eq("ticket_id", ticketId)
    .in("id", uniqueIds);

  if (!rows) return result;

  const signTargets = rows.filter(
    (row) => isImageMime(row.mime_type) && row.thumb_object_key !== null,
  );

  const signed = await Promise.all(
    signTargets.map(async (row) => {
      const { data } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(row.thumb_object_key!, SIGN_EXPIRES_SECONDS);
      return { id: row.id, url: data?.signedUrl ?? null };
    }),
  );

  const signedMap = new Map(signed.map((s) => [s.id, s.url]));

  for (const row of rows) {
    result.set(row.id, {
      id: row.id,
      ticketId: row.ticket_id,
      mimeType: row.mime_type,
      originalFilename: row.original_filename,
      width: row.width,
      height: row.height,
      signedThumbnailUrl: signedMap.get(row.id) ?? null,
    });
  }

  return result;
}
