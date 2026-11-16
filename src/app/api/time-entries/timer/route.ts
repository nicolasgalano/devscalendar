import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import { updateActiveTimerSchema } from "@/lib/validation/time-entries";
import type { Database } from "@/types/database";

type ActiveTimerUpdate = Database["public"]["Tables"]["active_timers"]["Update"];

/**
 * Editar el cronómetro corriendo in-flight (feature 030). Permite cambiar
 * proyecto, tarea, ticket, started_at y description sin parar el timer.
 *
 * El uso principal es la running card de `/my-time`: el user clickea un
 * campo, el popover inline hace PATCH acá, el server valida y persiste.
 *
 * Guards:
 *   1. Hay timer activo del user (si no, 404 `no_timer` — igual que
 *      /timer/stop al no encontrar nada).
 *   2. Si cambia `project_id`: re-chequear `can_view_project` del nuevo.
 *      El cliente debería mandar `ticket_id` y `activity_id` como null
 *      cuando cambia project (son por-proyecto); el handler igual los
 *      valida contra el proyecto final como defensa en profundidad.
 *   3. Ticket + activity contra el proyecto final.
 *   4. `started_at` no puede ser futuro (no tiene sentido para un timer).
 *
 * La RLS de `active_timers` filtra por `user_id = auth.uid()`, así que el
 * `.update()` no necesita filtro adicional por user.
 */
export async function PATCH(request: Request) {
  const parsed = updateActiveTimerSchema.safeParse(await readJsonBody(request));
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

  const supabase = await createClient();

  const { data: current } = await supabase
    .from("active_timers")
    .select("user_id, project_id, ticket_id, activity_id, started_at, description")
    .maybeSingle();

  if (!current) {
    return NextResponse.json(
      { error: "No hay cronómetro corriendo", reason: "no_timer" },
      { status: 404 },
    );
  }

  const finalProjectId = parsed.data.project_id ?? current.project_id;

  // Guard: si cambia el project, verificar membership del nuevo.
  if (parsed.data.project_id && parsed.data.project_id !== current.project_id) {
    const { data: canView } = await supabase.rpc("can_view_project", {
      p_project_id: parsed.data.project_id,
      p_user_id: profile.id,
    });
    if (!canView) {
      return NextResponse.json(
        { error: "No sos miembro del proyecto destino", reason: "not_member" },
        { status: 403 },
      );
    }
  }

  // Cross-checks contra el proyecto final.
  if (parsed.data.ticket_id) {
    const { data: ticket } = await supabase
      .from("tickets")
      .select("project_id")
      .eq("id", parsed.data.ticket_id)
      .maybeSingle();
    if (!ticket || ticket.project_id !== finalProjectId) {
      return NextResponse.json(
        { error: "El ticket no pertenece a este proyecto" },
        { status: 400 },
      );
    }
  }
  if (parsed.data.activity_id) {
    const { data: activity } = await supabase
      .from("project_activities")
      .select("project_id, active")
      .eq("id", parsed.data.activity_id)
      .maybeSingle();
    if (!activity || activity.project_id !== finalProjectId) {
      return NextResponse.json(
        { error: "La actividad no pertenece a este proyecto" },
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

  // Guard: `started_at` no futuro. Si viene, parse + compare contra now.
  if (parsed.data.started_at) {
    const startedAt = new Date(parsed.data.started_at);
    if (Number.isNaN(startedAt.getTime())) {
      return NextResponse.json(
        { error: "started_at inválido", reason: "invalid_date" },
        { status: 400 },
      );
    }
    if (startedAt.getTime() > Date.now()) {
      return NextResponse.json(
        {
          error: "started_at no puede ser futuro",
          reason: "future_start",
        },
        { status: 400 },
      );
    }
  }

  const updatePayload: ActiveTimerUpdate = {};
  if (parsed.data.project_id !== undefined) updatePayload.project_id = parsed.data.project_id;
  if (parsed.data.ticket_id !== undefined) updatePayload.ticket_id = parsed.data.ticket_id;
  if (parsed.data.activity_id !== undefined) updatePayload.activity_id = parsed.data.activity_id;
  if (parsed.data.started_at !== undefined) updatePayload.started_at = parsed.data.started_at;
  if (parsed.data.description !== undefined) updatePayload.description = parsed.data.description;

  const { data, error } = await supabase
    .from("active_timers")
    .update(updatePayload)
    .eq("user_id", profile.id)
    .select(
      `
        user_id, project_id, ticket_id, activity_id, started_at, description,
        project:projects!inner ( name, key ),
        ticket:tickets ( numero, title ),
        activity:project_activities ( name )
      `,
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    // La RLS filtró en silencio (otro tab stopeó el timer entre la lectura y
    // el update), o el timer desapareció por otra razón. Devolver 404 para
    // que el cliente sincronice.
    return NextResponse.json(
      { error: "No hay cronómetro corriendo", reason: "no_timer" },
      { status: 404 },
    );
  }

  const row = data as unknown as {
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
  const projectKey = row.project?.key ?? "";
  return NextResponse.json({
    ok: true,
    timer: {
      userId: row.user_id,
      projectId: row.project_id,
      projectName: row.project?.name ?? "",
      ticketId: row.ticket_id,
      ticketKey: row.ticket ? `${projectKey}-${row.ticket.numero}` : null,
      ticketTitle: row.ticket?.title ?? null,
      activityId: row.activity_id,
      activityName: row.activity?.name ?? null,
      startedAt: row.started_at,
      description: row.description,
    },
  });
}
