import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireProjectMembership } from "@/lib/api/require-project-membership";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import { formatTicketKey } from "@/lib/tickets/keys";
import { createTicketSchema } from "@/lib/validation/tickets";
import type { Database } from "@/types/database";

/**
 * Alta de ticket. Combina las cuatro capas de defensa que tiene la feature:
 *
 *   - RLS de `tickets: contributor+ insert` (migration 14 §8).
 *   - Este handler: guard de rol, chequeos de proyecto activo y de miembro-
 *     idad del asignado, formato de la clave visible.
 *   - Trigger `assign_ticket_number` que asigna `numero` con lock de fila
 *     (§9 de la migration).
 *   - Trigger `notify_ticket_events` que escribe la fila en `notifications`
 *     dentro de la misma transacción (§13).
 *
 * `numero` NO viaja en el insert — lo pone el trigger. El generado de
 * Supabase lo marca como required en `Insert` porque la columna es not-null
 * sin default de tabla; el cast a `unknown` es el mínimo trabajo para que
 * TypeScript no se queje sin agregar una migration extra al scope de 015.
 */
export async function POST(request: Request) {
  const parsed = createTicketSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { project_id, title, description_doc, priority, assignee_id } = parsed.data;

  const guard = await requireProjectMembership(project_id, "contributor");
  if (!guard.ok) return guard.response;
  const { supabase, userId } = guard;

  // Proyecto activo (AC-2.5). La garantía dura es el `with check` de la policy,
  // pero un 409 con motivo se lee mejor que "new row violates row-level
  // security policy".
  const { data: project } = await supabase
    .from("projects")
    .select("key, active")
    .eq("id", project_id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!project.active) {
    return NextResponse.json({ error: "Ese proyecto está desactivado" }, { status: 409 });
  }

  // AC-2.3: el asignado tiene que poder ver el proyecto. `can_view_project`
  // cubre admin, PM primario y miembros activos — la misma unión que la RLS.
  if (assignee_id) {
    const { data: canView } = await supabase.rpc("can_view_project", {
      p_project_id: project_id,
      p_user_id: assignee_id,
    });
    if (!canView) {
      return NextResponse.json(
        { error: "El asignado no es miembro del proyecto" },
        { status: 400 },
      );
    }
  }

  const insertPayload = {
    project_id,
    title,
    // 019: description_doc es la fuente de verdad. La columna `description`
    // (markdown) queda `null` para escrituras nuevas — solo se lee como
    // fallback en tickets viejos hasta la fase 2 (drop de columna).
    description_doc: description_doc ?? null,
    priority,
    assignee_id: assignee_id ?? null,
    created_by: userId,
    // `status = 'todo'` viene del default de la tabla; no lo aceptamos del
    // cliente (AC-2.1).
  };

  const { data, error } = await supabase
    .from("tickets")
    // Cast: `numero` lo pone el trigger `assign_ticket_number` con
    // `new.numero is null`. El codegen no ve triggers y marca la columna como
    // required.
    .insert(insertPayload as unknown as Database["public"]["Tables"]["tickets"]["Insert"])
    .select("*")
    .single();

  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Referencia inválida (proyecto o usuario)" },
        { status: 400 },
      );
    }
    if (error.code === "23514") {
      return NextResponse.json(
        { error: "El título no cumple los requisitos (1–200 caracteres)" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  dispatchNotifications();

  return NextResponse.json(
    { ...data, key: formatTicketKey({ key: project.key, numero: data.numero }) },
    { status: 201 },
  );
}
