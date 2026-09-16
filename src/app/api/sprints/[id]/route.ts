import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireProjectMembership } from "@/lib/api/require-project-membership";
import { createClient } from "@/lib/supabase/server";
import { updateSprintSchema } from "@/lib/validation/sprints";

/**
 * PATCH de sprint (018 T2.4). Acepta cambios de metadata (name, goal, fechas)
 * y **solo la transición a `active`**. El cierre (`completed`) NO va por acá
 * — va por `POST /api/sprints/:id/close`, que hace el rollover y el snapshot
 * en una transacción con `close_sprint_with_rollover`.
 *
 * Traducciones:
 *   - `23505` sobre `sprints_one_active_per_project` → 409 con reason
 *     `active_sprint_exists` (la UI debería haberlo prevenido escondiendo el
 *     botón "Activar" cuando ya hay otro, pero un race llega acá).
 *   - `23514` del trigger `enforce_sprint_status_transitions` → 400 con reason.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = updateSprintSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Leo el sprint primero para conocer el project_id sin depender del cliente
  // (mismo patrón que 015 T5.2 para tickets). Si RLS lo filtra, `data` es null
  // y respondemos 404 sin distinguir "no existe" de "no visible" (AC-6.1 del
  // spec de 015).
  const readClient = await createClient();

  const { data: sprint } = await readClient
    .from("sprints")
    .select("id, project_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!sprint) {
    return NextResponse.json({ error: "Sprint no encontrado" }, { status: 404 });
  }

  const guard = await requireProjectMembership(sprint.project_id, "pm");
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const { data, error } = await supabase
    .from("sprints")
    .update({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.goal !== undefined && { goal: parsed.data.goal }),
      ...(parsed.data.starts_at !== undefined && { starts_at: parsed.data.starts_at }),
      ...(parsed.data.ends_at !== undefined && { ends_at: parsed.data.ends_at }),
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      // sprints_one_active_per_project — unique parcial.
      return NextResponse.json(
        {
          error: "Ya hay otro sprint activo en el proyecto",
          reason: "active_sprint_exists",
        },
        { status: 409 },
      );
    }
    if (error.code === "23514") {
      return NextResponse.json(
        { error: error.message, reason: (error as { hint?: string }).hint ?? undefined },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
