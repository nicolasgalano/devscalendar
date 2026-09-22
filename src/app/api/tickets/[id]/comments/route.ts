import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { extractMentionUserIds } from "@/lib/editor/extract-mentions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/session";
import { commentBodySchema } from "@/lib/validation/comments";
import type { Database } from "@/types/database";

type TicketCommentInsert = Database["public"]["Tables"]["ticket_comments"]["Insert"];

// POST /api/tickets/[id]/comments
//
// Crea un comentario nuevo sobre el ticket. Cualquier viewer del proyecto
// puede comentar (spec AC-1.5). La RLS de `ticket_comments` es la garantía
// dura; este handler solo agrega la validación de que las @menciones sean
// miembros activos del proyecto — no lo puede hacer una policy porque
// requiere un join contra `project_members` filtrado por los uuid del doc.
//
// Errores:
//   400 — body_doc inválido (validador de rich text).
//   401 — sin sesión.
//   404 — ticket no visible (RLS del select filtra).
//   422 — el doc menciona a alguien que no es miembro activo del proyecto.
//   500 — insert falla (bug del handler, no del cliente).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: ticketId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await readJsonBody(request);
  const parsed = commentBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // El select respeta RLS: si el ticket no existe o no es visible, 404.
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, project_id")
    .eq("id", ticketId)
    .maybeSingle();

  if (!ticket) {
    return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
  }

  // Chequeo de menciones válidas. Los uuid del doc tienen que corresponder
  // a miembros activos del proyecto. Sin esto se puede mencionar a alguien
  // de otro proyecto (leak de directorio) o a un usuario desactivado.
  const mentionIds = extractMentionUserIds(parsed.data.body_doc);
  if (mentionIds.length > 0) {
    const { data: valid } = await supabase
      .from("project_members")
      .select("user_id, profiles!inner(active)")
      .eq("project_id", ticket.project_id)
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

  const insertPayload = {
    ticket_id: ticket.id,
    author_id: user.id,
    body_doc: parsed.data.body_doc,
  } as unknown as TicketCommentInsert;

  const { data, error } = await supabase
    .from("ticket_comments")
    .insert(insertPayload)
    .select("id, ticket_id, author_id, body_doc, created_at, updated_at")
    .single();

  if (error) {
    // 42501 es RLS reject; el único vector es sesión inválida (raro después
    // de haber pasado el select del ticket) o comment insertado con
    // author_id != auth.uid() — no debería pasar acá.
    if (error.code === "42501") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
