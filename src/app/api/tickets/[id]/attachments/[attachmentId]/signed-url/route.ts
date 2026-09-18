import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTicketAccess } from "@/lib/api/require-ticket-access";
import { ATTACHMENT_BUCKET } from "@/lib/attachments/types";

const SIGN_EXPIRES_SECONDS = 15 * 60; // 15 min (§3.2 del plan)

const variantSchema = z.enum(["thumb", "original"]).default("thumb");

/**
 * GET /api/tickets/[id]/attachments/[attachmentId]/signed-url?variant=thumb|original
 *
 * Devuelve una URL firmada del objeto pedido, con expiración corta. El
 * cliente la usa para renderizar el thumb en el panel o el original en el
 * lightbox — nunca accede al bucket directo.
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

  // Guard del ticket (RLS + membresía).
  const guard = await requireTicketAccess(ticketId);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  // Traer el attachment y validar que pertenece al ticket del path. Si la
  // fila no existe o RLS la esconde, devolvemos 404.
  const { data: attachment } = await supabase
    .from("ticket_attachments")
    .select("id, ticket_id, object_key, thumb_object_key")
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

  const targetPath =
    variant === "original" ? attachment.object_key : attachment.thumb_object_key;

  const { data: signed, error: signError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(targetPath, SIGN_EXPIRES_SECONDS);

  if (signError || !signed) {
    return NextResponse.json(
      { error: "No se pudo generar la URL firmada", detail: signError?.message },
      { status: 500 },
    );
  }

  const expiresAt = new Date(Date.now() + SIGN_EXPIRES_SECONDS * 1000).toISOString();
  return NextResponse.json({ url: signed.signedUrl, expiresAt });
}
