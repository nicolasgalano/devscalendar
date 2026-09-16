import { NextResponse } from "next/server";

import { requireProjectMembership } from "@/lib/api/require-project-membership";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";

/**
 * Cierre de sprint (018 T2.5). El endpoint más "pesado" de la feature.
 *
 * **Tres guards en orden:**
 *   1. `requireProjectMembership(project_id, 'pm')` — admin o PM del proyecto.
 *   2. **`profile.id === project.pm_id`** — solo PM primario firma el cierre
 *      (AC-5.4 del spec). Admin queda fuera acá.
 *   3. Sprint tiene que estar en `status = 'active'`.
 *
 * **Preflight:** cuenta los tickets no completados. Si hay pendientes y NO hay
 * sprint `planned` en el proyecto, devuelve 409 con `reason: 'needs_next_sprint'`
 * — el cliente muestra el diálogo "Creá el próximo sprint antes de cerrar" y
 * ofrece crearlo inline.
 *
 * **Ejecución:** llama al RPC `close_sprint_with_rollover(p_sprint_id, p_next_sprint_id)`
 * que atómicamente compone el snapshot, rollea los pendientes y cierra el
 * sprint. Ver `plan.md` §5.3 y `supabase/migrations/00000000000016_sprints.sql`.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Leo el sprint + su proyecto (para conocer pm_id) con el cliente auth.
  // RLS filtra: si no puedo ver el sprint, 404.
  const { data: sprint } = await supabase
    .from("sprints")
    .select("id, project_id, status, projects:projects!inner ( id, pm_id )")
    .eq("id", id)
    .maybeSingle();

  if (!sprint) {
    return NextResponse.json({ error: "Sprint no encontrado" }, { status: 404 });
  }

  // Guard 1: membership pm+.
  const guard = await requireProjectMembership(sprint.project_id, "pm");
  if (!guard.ok) return guard.response;

  // Guard 2: solo PM primario cierra. Admin queda fuera. Motivo en spec §4 US-5
  // y en el plan §4.2 — la firma del reporte es del owner del proyecto.
  const projectPmId = sprint.projects.pm_id;
  if (profile.id !== projectPmId) {
    return NextResponse.json(
      {
        error: "Solo el PM del proyecto puede cerrar el sprint",
        reason: "pm_only_close",
      },
      { status: 403 },
    );
  }

  // Guard 3: tiene que estar activo.
  if (sprint.status !== "active") {
    return NextResponse.json(
      {
        error: "El sprint no está activo",
        reason: "not_active",
      },
      { status: 409 },
    );
  }

  // Preflight: pendientes + siguiente sprint planificado.
  const { data: pendingRows } = await supabase
    .from("tickets")
    .select("id")
    .eq("sprint_id", id)
    .not("status", "in", "(done,cancelled)");

  const pendingCount = pendingRows?.length ?? 0;

  let nextSprintId: string | null = null;
  if (pendingCount > 0) {
    const { data: nextSprint } = await supabase
      .from("sprints")
      .select("id")
      .eq("project_id", sprint.project_id)
      .eq("status", "planned")
      .order("starts_at", { ascending: true })
      .order("numero", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!nextSprint) {
      return NextResponse.json(
        {
          error: "Hay tickets pendientes y no hay próximo sprint donde moverlos",
          reason: "needs_next_sprint",
          pendingCount,
        },
        { status: 409 },
      );
    }

    nextSprintId = nextSprint.id;
  }

  // Ejecución: RPC transaccional. `nextSprintId` puede ser null cuando no hay
  // pendientes — la función lo maneja.
  const { data: result, error } = await supabase.rpc("close_sprint_with_rollover", {
    p_sprint_id: id,
    // El type generado marca p_next_sprint_id como required, pero la función
    // acepta null cuando no hay tickets a rollover. El cast es cosmético.
    p_next_sprint_id: nextSprintId as string,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message, reason: (error as { hint?: string }).hint ?? undefined },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    result,
    nextSprintId,
  });
}
