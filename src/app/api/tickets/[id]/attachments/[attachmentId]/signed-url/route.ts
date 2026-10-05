import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTicketAccess } from "@/lib/api/require-ticket-access";
import { ATTACHMENT_BUCKET } from "@/lib/attachments/types";

const SIGN_EXPIRES_SECONDS = 15 * 60; // 15 min (020 §3.2 del plan)

const variantSchema = z.enum(["thumb", "original"]).default("thumb");

/**
 * GET /api/tickets/[id]/attachments/[attachmentId]/signed-url
 *
 * Query params:
 *   - `variant=thumb|original` (default `thumb`). Thumb solo tiene sentido
 *     para imágenes; para no-imagen (PDF, docs — 025) devuelve 404.
 *   - `download=1` (opcional). Si está, pide a Supabase Storage que la URL
 *     firmada responda con `Content-Disposition: attachment; filename="..."`,
 *     usando el `original_filename` guardado. Esto fuerza al browser a
 *     descargar y no renderizar inline — crítico para PDFs y docs (025) y
 *     opcional para imágenes (cuando el user clickea "Descargar" en el
 *     lightbox).
 *
 * Guard: el `requireTicketAccess` valida que el user puede ver el ticket. Y
 * verificamos que `attachment.ticket_id` matchee el ticket del path, para
 * que no se puedan pedir URLs cross-ticket manipulando el id.
 *
 * La firma la emite el cliente authenticated (no service_role): Supabase
 * Storage acepta `createSignedUrl` con cualquier rol que tenga select sobre
 * `storage.objects` para ese path — y la policy de select ya replica
 * `can_view_project`. Si el rol no puede ver el objeto, la firma falla.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { id: ticketId, attachmentId } = await params;
  const url = new URL(request.url);

  const parsedVariant = variantSchema.safeParse(url.searchParams.get("variant"));
  if (!parsedVariant.success) {
    return NextResponse.json(
      { error: "variant inválido, aceptados: thumb | original" },
      { status: 400 },
    );
  }
  const variant = parsedVariant.data;
  const forceDownload = url.searchParams.get("download") === "1";

  // Guard del ticket (RLS + membresía).
  const guard = await requireTicketAccess(ticketId);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  // Traer el attachment y validar que pertenece al ticket del path. Si la
  // fila no existe o RLS la esconde, devolvemos 404.
  const { data: attachment } = await supabase
    .from("ticket_attachments")
    .select("id, ticket_id, object_key, thumb_object_key, original_filename")
    .eq("id", attachmentId)
    .maybeSingle();

  if (!attachment) {
    return NextResponse.json({ error: "Adjunto no encontrado" }, { status: 404 });
  }
  if (attachment.ticket_id !== ticketId) {
    // Existe pero es de otro ticket. 404 (no distinguir de "no existe" para
    // no revelar nada más de lo que RLS ya no oculta).
    return NextResponse.json({ error: "Adjunto no encontrado" }, { status: 404 });
  }

  // Thumb solo para imágenes. Los no-imagen (025) tienen `thumb_object_key`
  // null — devolver 404 explícito es más legible que un signed URL vacío.
  if (variant === "thumb" && !attachment.thumb_object_key) {
    return NextResponse.json(
      { error: "Este adjunto no tiene thumbnail" },
      { status: 404 },
    );
  }

  const targetPath =
    variant === "original" ? attachment.object_key : attachment.thumb_object_key!;

  const signOptions = forceDownload
    ? { download: attachment.original_filename }
    : undefined;

  const { data: signed, error: signError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(targetPath, SIGN_EXPIRES_SECONDS, signOptions);

  if (signError || !signed) {
    return NextResponse.json(
      { error: "No se pudo generar la URL firmada", detail: signError?.message },
      { status: 500 },
    );
  }

  const expiresAt = new Date(Date.now() + SIGN_EXPIRES_SECONDS * 1000).toISOString();
  return NextResponse.json({ url: signed.signedUrl, expiresAt });
}
