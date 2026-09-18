import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireTicketAccess } from "@/lib/api/require-ticket-access";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import { updateTicketSchema } from "@/lib/validation/tickets";
import type { Database } from "@/types/database";

type TicketUpdate = Database["public"]["Tables"]["tickets"]["Update"];

/**
 * PATCH de ticket. La granularidad fina (contributor edita propios, transiciona
 * ajenos, no reasigna) la impone el trigger `enforce_ticket_contributor_scope`
 * (migration 14 §12), NO este handler. El handler traduce los errores del
 * trigger a HTTP:
 *
 *   - `check_violation` (23514) con `hint` → 403 con `reason` desde el hint.
 *   - `check_violation` sin `hint` → 403 genérico (defensivo, no debería pasar).
 *   - No encontrado → 404 (AC-6.1: no distinguir "no existe" de "no autorizado").
 *
 * El asignado ajeno se puede cambiar sin verificar que sea miembro: el frontend
 * puede prevenirlo, pero acá no chequeamos porque si el que lo hace es `lead`
 * la RLS le permite escribir, y si es `contributor` el trigger rechaza antes
 * (reasignar es solo `lead+`). Cuando aterrice T5.1 con la regla explícita,
 * conviene extraer un helper y llamarlo también acá.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = updateTicketSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const guard = await requireTicketAccess(id);
  if (!guard.ok) return guard.response;
  const { supabase, ticket } = guard;

  // Si se reasigna: chequeo AC-2.3 análogo al POST — el nuevo asignado tiene
  // que poder ver el proyecto. `can_view_project` cubre admin/PM/miembro.
  if (parsed.data.assignee_id !== undefined && parsed.data.assignee_id !== null) {
    const { data: canView } = await supabase.rpc("can_view_project", {
      p_project_id: ticket.project_id,
      p_user_id: parsed.data.assignee_id,
    });
    if (!canView) {
      return NextResponse.json(
        { error: "El asignado no es miembro del proyecto" },
        { status: 400 },
      );
    }
  }

  // 019: si el cliente mandó `expected_updated_at`, es una escritura optimista
  // (el hidratador de checkboxes del `<RichTextViewer>` es el único caller
  // hoy). Si el ticket cambió entre la lectura y este PATCH, rebotamos con
  // 409 y el cliente refetchea antes de reintentar. Sin este chequeo, un
  // click al checklist justo después de que otro usuario edite la descripción
  // pisaría el cambio ajeno.
  if (parsed.data.expected_updated_at !== undefined) {
    if (parsed.data.expected_updated_at !== ticket.updated_at) {
      return NextResponse.json(
        {
          error: "El ticket cambió mientras editabas",
          reason: "conflict",
          currentUpdatedAt: ticket.updated_at,
        },
        { status: 409 },
      );
    }
  }

  // 018: si se cambia sprint_id (no a null), el sprint tiene que pertenecer al
  // mismo proyecto y no estar completado (AC-3.4). Un ticket con sprint
  // completado congela historia — no se puede reasignar.
  if (parsed.data.sprint_id !== undefined && parsed.data.sprint_id !== null) {
    const { data: sprint } = await supabase
      .from("sprints")
      .select("project_id, status")
      .eq("id", parsed.data.sprint_id)
      .maybeSingle();

    if (!sprint) {
      return NextResponse.json(
        { error: "Sprint no encontrado" },
        { status: 400 },
      );
    }
    if (sprint.project_id !== ticket.project_id) {
      return NextResponse.json(
        { error: "El sprint pertenece a otro proyecto" },
        { status: 400 },
      );
    }
    if (sprint.status === "completed") {
      return NextResponse.json(
        {
          error: "No se puede mover un ticket a un sprint cerrado",
          reason: "sprint_completed",
        },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from("tickets")
    .update({
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.description_doc !== undefined && {
        // Cast: `description_doc` es `Json` en la DB (unknown-ish); el tipo
        // derivado del validador de rich-text es `ProseMirrorNode` con
        // `attrs: Record<string, unknown>`. Ambas descripciones son de la
        // misma forma runtime; el cast lo declara.
        description_doc: parsed.data.description_doc as TicketUpdate["description_doc"],
      }),
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.priority !== undefined && { priority: parsed.data.priority }),
      ...(parsed.data.assignee_id !== undefined && { assignee_id: parsed.data.assignee_id }),
      ...(parsed.data.sprint_id !== undefined && { sprint_id: parsed.data.sprint_id }),
      ...(parsed.data.estimated_hours !== undefined && {
        estimated_hours: parsed.data.estimated_hours,
      }),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23514") {
      // El trigger de contributor scope tira `check_violation` con `hint`
      // — se traduce a 403. También cae acá el `check (length(title) between
      // 1 and 200)`, que es un 400. Se distinguen por el hint del trigger.
      const hint = (error as { hint?: string | null }).hint ?? null;
      if (hint) {
        return NextResponse.json({ error: "No autorizado", reason: hint }, { status: 403 });
      }
      return NextResponse.json(
        { error: "El título no cumple los requisitos" },
        { status: 400 },
      );
    }
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Referencia inválida (usuario asignado)" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    // El `update` no devolvió fila: la RLS filtró el update en silencio (la
    // policy no matcheó). Devolver 403 explícito en vez de un vacío raro.
    return NextResponse.json(
      { error: "No tenés permiso para editar este ticket" },
      { status: 403 },
    );
  }

  dispatchNotifications();

  return NextResponse.json(data);
}
