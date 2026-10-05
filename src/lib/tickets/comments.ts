import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ProseMirrorNode } from "@/lib/editor/validate";

export type CommentAuthor = {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
};

export type TicketComment = {
  id: string;
  ticketId: string;
  authorId: string;
  bodyDoc: ProseMirrorNode | null;
  createdAt: string;
  updatedAt: string;
  author: CommentAuthor;
};

/**
 * Feed de comentarios de un ticket en orden cronológico ascendente
 * (spec AC-7.1). La RLS de `ticket_comments` filtra por `can_view_project`,
 * así que si el caller ya tiene visibilidad del ticket, esta query devuelve
 * todos los comentarios legítimamente.
 *
 * Cap por defecto en 20 (spec AC-7.2): el MVP no soporta paginación hacia
 * atrás. Cuando aparezca un ticket con 100+ comentarios se resuelve con
 * "?showAll=1" o cursor — F1 de tasks.md.
 */
export async function getCommentsForTicket(
  ticketId: string,
  { limit = 20 }: { limit?: number } = {},
): Promise<TicketComment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ticket_comments")
    .select(
      `
        id, ticket_id, author_id, body_doc, created_at, updated_at,
        author:profiles!inner(id, full_name, avatar_url)
      `,
    )
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id,
    ticketId: row.ticket_id,
    authorId: row.author_id,
    bodyDoc: row.body_doc as ProseMirrorNode | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: {
      id: row.author.id,
      fullName: row.author.full_name,
      avatarUrl: row.author.avatar_url,
    },
  }));
}
