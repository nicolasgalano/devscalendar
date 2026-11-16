import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import { startTimerSchema } from "@/lib/validation/time-entries";

/**
 * Arrancar cronómetro (016 T2.5).
 *
 * Feature 030: si ya hay un `active_timer` del user, el handler devuelve
 * **409** `reason: 'timer_active'` con la fila del timer activo, en vez de
 * stopear-y-arrancar silenciosamente. El cliente decide: guardar el viejo
 * (POST `/timer/stop` + re-POST acá), descartarlo (POST `/timer/discard` +
 * re-POST acá), o cancelar. Esto resuelve el bug reportado por Emiliano
 * (bloques random o errores `23514` cuando quedó un timer olvidado hace
 * días). El RPC `stop_and_start_timer` sigue vigente para el caso feliz
 * (sin timer previo) por atomicidad.
 *
 * Chequeos:
 *   - Ticket ↔ project match (defensivo, la UI ya lo hace).
 *   - Activity ↔ project match + activa (idem).
 *   - Actividad requerida si el proyecto tiene ≥1 activa (AC-1.5).
 *   - Membership: el user debe ser contributor+ del proyecto (RLS de
 *     active_timers exige `user_id = auth.uid()`, pero además necesitamos
 *     que pueda cargar time_entries en ese proyecto). El chequeo se hace
 *     con `can_view_project`.
 *
 * Response: `{ ok, result: { stopped_entry_id?, started_at } }` en 201.
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

  // Feature 030: avisar antes de pisar. Si ya hay un timer activo, el cliente
  // tiene que decidir qué hacer con él (stop o discard) antes de pedir uno
  // nuevo. La RLS filtra por auth.uid() y active_timers tiene PK = user_id,
  // así que `.maybeSingle()` devuelve a lo sumo la fila del propio user.
  const { data: existing } = await supabase
    .from("active_timers")
    .select(
      `
        user_id, project_id, ticket_id, activity_id, started_at, description,
        project:projects!inner ( name, key ),
        ticket:tickets ( numero, title ),
        activity:project_activities ( name )
      `,
    )
    .maybeSingle();
  if (existing) {
    const existingRow = existing as unknown as {
      user_id: string;
      project_id: string;
      ticket_id: string | null;
      activity_id: string | null;
      started_at: string;
      description: string | null;
      project: { name: string; key: string } | null;
      ticket: { numero: number; title: string } | null;
      activity: { name: string } | null;
    };
    const projectKey = existingRow.project?.key ?? "";
    return NextResponse.json(
      {
        error: "Ya hay un cronómetro corriendo",
        reason: "timer_active",
        timer: {
          userId: existingRow.user_id,
          projectId: existingRow.project_id,
          projectName: existingRow.project?.name ?? "",
          ticketId: existingRow.ticket_id,
          ticketKey: existingRow.ticket
            ? `${projectKey}-${existingRow.ticket.numero}`
            : null,
          ticketTitle: existingRow.ticket?.title ?? null,
          activityId: existingRow.activity_id,
          activityName: existingRow.activity?.name ?? null,
          startedAt: existingRow.started_at,
          description: existingRow.description,
        },
      },
      { status: 409 },
    );
  }

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
