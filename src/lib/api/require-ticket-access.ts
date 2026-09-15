import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import {
  requireProjectMembership,
  type ProjectMembershipGuard,
} from "./require-project-membership";

type TicketRow = Database["public"]["Tables"]["tickets"]["Row"];

export type TicketAccessGuard =
  | (Extract<ProjectMembershipGuard, { ok: true }> & { ticket: TicketRow })
  | { ok: false; response: NextResponse };

/**
 * Verifica que quien llama pueda actuar sobre el ticket.
 *
 * Hace primero un `select` con el cliente autenticado (que respeta RLS). Si
 * el ticket no existe o no es visible, devuelve 404 sin distinguir los dos
 * casos — AC-6.1 del spec, R-4 del plan. Un 403 acá revelaría que el ticket
 * existe pero no lo puedo ver, que es exactamente lo que no queremos.
 *
 * Cuando existe y es visible, delega en `requireProjectMembership(project_id,
 * 'contributor')`. Quien puede leer el ticket a través de RLS es al menos
 * miembro del proyecto (o admin/PM), pero el minRole `contributor` filtra a
 * los `viewer`. El rol devuelto se usa en el handler para reglas más finas
 * (por ej: solo `lead` reasigna, aunque el trigger también lo va a bloquear).
 */
export async function requireTicketAccess(ticketId: string): Promise<TicketAccessGuard> {
  const supabase = await createClient();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", ticketId)
    .maybeSingle();

  if (!ticket) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 }),
    };
  }

  const membership = await requireProjectMembership(ticket.project_id, "contributor");
  if (!membership.ok) return membership;

  return { ...membership, ticket };
}
