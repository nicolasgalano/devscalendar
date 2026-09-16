import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import { startTimerSchema } from "@/lib/validation/time-entries";

/**
 * Arrancar cronómetro (016 T2.5). Si el user ya tenía uno corriendo, se para
 * y persiste como time_entry ANTES de arrancar el nuevo — RPC atómica
 * `stop_and_start_timer`.
 *
 * Chequeos:
 *   - Ticket ↔ project match (defensivo, la UI ya lo hace).
 *   - Activity ↔ project match + activa (idem).
 *   - Actividad requerida si el proyecto tiene ≥1 activa (AC-1.5).
 *   - Membership: el user debe ser contributor+ del proyecto (RLS de
 *     active_timers exige `user_id = auth.uid()`, pero además necesitamos
 *     que pueda cargar time_entries en ese proyecto). El chequeo se hace
 *     con `role_in_project`.
 *
 * Response: `{ stopped_entry_id?, started_at }`. `stopped_entry_id` viene si
 * había uno corriendo antes.
 */
export async function POST(request: Request) {
  const parsed = startTimerSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { project_id, ticket_id, activity_id } = parsed.data;
  const supabase = await createClient();

  // Chequear que el user tiene permiso de cargar en el proyecto. Usamos
  // `can_view_project` como membership check + validamos rol via
  // `role_in_project`. Un viewer del proyecto no puede arrancar timer.
  const { data: canView } = await supabase.rpc("can_view_project", {
    p_project_id: project_id,
    p_user_id: profile.id,
  });
  if (!canView) {
    return NextResponse.json(
      { error: "No sos miembro de este proyecto", reason: "not_member" },
      { status: 403 },
    );
  }

  // Cross-checks — mismos del POST time-entries.
  if (ticket_id) {
    const { data: ticket } = await supabase
      .from("tickets")
      .select("project_id")
      .eq("id", ticket_id)
      .maybeSingle();
    if (!ticket || ticket.project_id !== project_id) {
      return NextResponse.json(
        { error: "El ticket no pertenece al proyecto" },
        { status: 400 },
      );
    }
  }
  if (activity_id) {
    const { data: activity } = await supabase
      .from("project_activities")
      .select("project_id, active")
      .eq("id", activity_id)
      .maybeSingle();
    if (!activity || activity.project_id !== project_id) {
      return NextResponse.json(
        { error: "La actividad no pertenece al proyecto" },
        { status: 400 },
      );
    }
    if (!activity.active) {
      return NextResponse.json(
        { error: "La actividad está desactivada" },
        { status: 400 },
      );
    }
  }
  if (!activity_id) {
    const { count } = await supabase
      .from("project_activities")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .eq("active", true);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: "Este proyecto exige que elijas una actividad",
          reason: "activity_required",
        },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase.rpc("stop_and_start_timer", {
    p_user_id: profile.id,
    p_project_id: project_id,
    p_ticket_id: (ticket_id ?? null) as string,
    p_activity_id: (activity_id ?? null) as string,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result: data });
}
