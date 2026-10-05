import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { extractMentionUserIds } from "@/lib/editor/extract-mentions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/session";
import { commentPatchSchema } from "@/lib/validation/comments";
import type { Database } from "@/types/database";

type TicketCommentUpdate = Database["public"]["Tables"]["ticket_comments"]["Update"];

// PATCH /api/tickets/[id]/comments/[commentId]
//
// Edita el body_doc de un comentario. Solo el autor puede editar (RLS).
// Requiere `expected_updated_at` matching — cierra la ventana entre lectura
// y escritura (spec AC-5.5, patrón 005/019).
//
// Menciones nuevas del edit disparan `ticket_mentioned` (el trigger SQL las
// detecta comparando old vs new); menciones que ya estaban NO re-notifican.
// Sacar menciones NO rescinde avisos previos (AC-2.7).
//
// Errores:
//   400 — body inválido.
//   401 — sin sesión.
//   403 — no soy el autor (RLS lo tira como 42501 → 403).
//   404 — comentario o ticket no visible.
//   409 — `expected_updated_at` no matchea el actual (stale_update).
//   422 — mención inválida (mismo criterio que el POST).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id: ticketId, commentId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await readJsonBody(request);
  const parsed = commentPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // Read del actual (respeta RLS — visible solo a miembros del proyecto).
  const { data: current } = await supabase
    .from("ticket_comments")
    .select("id, ticket_id, updated_at, tickets!inner(project_id)")
    .eq("id", commentId)
    .eq("ticket_id", ticketId)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "Comentario no encontrado" }, { status: 404 });
  }

  // Chequeo temprano de stale (patrón bookings). El segundo chequeo va en
  // el .eq() del update — cierra la ventana entre este read y el write.
  if (current.updated_at !== parsed.data.expected_updated_at) {
    return NextResponse.json(
      { error: "El comentario cambió mientras editabas", code: "stale_update" },
      { status: 409 },
    );
  }

  // Chequeo de menciones — igual que el POST.
  const projectId = current.tickets.project_id;
  const mentionIds = extractMentionUserIds(parsed.data.body_doc);
  if (mentionIds.length > 0) {
    const { data: valid } = await supabase
      .from("project_members")
      .select("user_id, profiles!inner(active)")
      .eq("project_id", projectId)
      .eq("active", true)
      .eq("profiles.active", true)
      .in("user_id", mentionIds);

    const validIds = new Set((valid ?? []).map((row) => row.user_id));
    const invalid = mentionIds.filter((id) => !validIds.has(id));

    if (invalid.length > 0) {
      return NextResponse.json(
        { error: "Menciones inválidas", code: "mention_target_invalid", user_ids: invalid },
        { status: 422 },
      );
    }
  }

  const nextUpdatedAt = new Date().toISOString();
  const updatePayload = {
    body_doc: parsed.data.body_doc,
    updated_at: nextUpdatedAt,
  } as unknown as TicketCommentUpdate;
  const { data, error } = await supabase
    .from("ticket_comments")
    .update(updatePayload)
    .eq("id", commentId)
    .eq("updated_at", parsed.data.expected_updated_at)
    .select("id, ticket_id, author_id, body_doc, created_at, updated_at")
    .maybeSingle();

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Zero rows → race lost entre el select y el update (otra tab editó justo
  // ahora, o autor cambió — imposible pero defensivo).
  if (!data) {
    return NextResponse.json(
      { error: "El comentario cambió mientras editabas", code: "stale_update" },
      { status: 409 },
    );
  }

  return NextResponse.json(data);
}

// DELETE /api/tickets/[id]/comments/[commentId]
//
// Borra un comentario. La RLS decide autorización (autor OR PM primario OR
// admin). El trigger de audit corre solo y guarda snapshot completo.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id: ticketId, commentId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const supabase = await createClient();

  // Verificar que el comentario pertenezca al ticket. Sin esto un cliente
  // que sepa el commentId puede borrarlo desde cualquier URL de ticket
  // (no cambia autorización porque la RLS igual filtra, pero el 404
  // temprano es mejor UX y evita audit noise).
  const { data: current } = await supabase
    .from("ticket_comments")
    .select("id")
    .eq("id", commentId)
    .eq("ticket_id", ticketId)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "Comentario no encontrado" }, { status: 404 });
  }

  const { error, count } = await supabase
    .from("ticket_comments")
    .delete({ count: "exact" })
    .eq("id", commentId);

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sin filas borradas + sin error → la RLS filtró (usuario no autorizado).
  // Es el caso "veo el comentario pero no lo puedo borrar".
  if (count === 0) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  return new NextResponse(null, { status: 204 });
}
