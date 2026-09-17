import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { isAdmin } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import { updateTimeEntrySchema } from "@/lib/validation/time-entries";

const EDIT_WINDOW_DAYS = 7;

/**
 * Ventana de edición en días — 016 AC-5.2. Los users tienen 7 días para
 * editar/borrar sus propias entries; admin sin límite. Se computa contra
 * `logged_at` (la fecha del trabajo), no contra `created_at`.
 */
function isWithinEditWindow(loggedAt: string): boolean {
  const logged = new Date(`${loggedAt}T00:00:00Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diffDays = Math.floor(
    (today.getTime() - logged.getTime()) / (1000 * 60 * 60 * 24),
  );
  return diffDays <= EDIT_WINDOW_DAYS;
}

/**
 * PATCH de time entry (016 T2.3). Guards:
 *   1. Leer entry, RLS filtra por scope.
 *   2. Ownership: si el actor no es admin y no es el user_id → 403.
 *   3. Ventana de edición: si el actor no es admin y logged_at es > 7 días →
 *      403 con `reason: 'edit_window_expired'`.
 *   4. Chequeos cross-table (ticket, actividad) si cambian.
 *   5. Update; trigger de audit registra el diff.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = updateTimeEntrySchema.safeParse(await readJsonBody(request));
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

  const { data: entry } = await supabase
    .from("time_entries")
    .select("id, user_id, project_id, logged_at")
    .eq("id", id)
    .maybeSingle();

  if (!entry) {
    return NextResponse.json({ error: "Entry no encontrada" }, { status: 404 });
  }

  const actorIsAdmin = isAdmin(profile.roles);
  const actorIsOwner = entry.user_id === profile.id;

  if (!actorIsAdmin && !actorIsOwner) {
    return NextResponse.json(
      { error: "No podés editar entries ajenas", reason: "not_owner" },
      { status: 403 },
    );
  }

  if (!actorIsAdmin && !isWithinEditWindow(entry.logged_at)) {
    return NextResponse.json(
      {
        error: `Solo se pueden editar entries de los últimos ${EDIT_WINDOW_DAYS} días`,
        reason: "edit_window_expired",
      },
      { status: 403 },
    );
  }

  // Cross-checks si cambia ticket o actividad — mismo criterio del POST.
  if (parsed.data.ticket_id) {
    const { data: ticket } = await supabase
      .from("tickets")
      .select("project_id")
      .eq("id", parsed.data.ticket_id)
      .maybeSingle();
    if (!ticket || ticket.project_id !== entry.project_id) {
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
    if (!activity || activity.project_id !== entry.project_id) {
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

  const { data, error } = await supabase
    .from("time_entries")
    .update({
      ...(parsed.data.ticket_id !== undefined && { ticket_id: parsed.data.ticket_id }),
      ...(parsed.data.activity_id !== undefined && {
        activity_id: parsed.data.activity_id,
      }),
      ...(parsed.data.minutes !== undefined && { minutes: parsed.data.minutes }),
      ...(parsed.data.logged_at !== undefined && { logged_at: parsed.data.logged_at }),
      ...(parsed.data.description !== undefined && {
        description: parsed.data.description,
      }),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23514") {
      return NextResponse.json(
        { error: "Datos inválidos", reason: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/**
 * DELETE de time entry (016 T2.4). Mismos guards de ownership + ventana. El
 * trigger de audit captura el snapshot pre-borrado. El trigger de notify
 * dispara `time_entry_deleted_by_admin` si admin borra ajena.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const supabase = await createClient();

  const { data: entry } = await supabase
    .from("time_entries")
    .select("id, user_id, logged_at")
    .eq("id", id)
    .maybeSingle();

  if (!entry) {
    return NextResponse.json({ error: "Entry no encontrada" }, { status: 404 });
  }

  const actorIsAdmin = isAdmin(profile.roles);
  const actorIsOwner = entry.user_id === profile.id;

  if (!actorIsAdmin && !actorIsOwner) {
    return NextResponse.json(
      { error: "No podés borrar entries ajenas", reason: "not_owner" },
      { status: 403 },
    );
  }

  if (!actorIsAdmin && !isWithinEditWindow(entry.logged_at)) {
    return NextResponse.json(
      {
        error: `Solo se pueden borrar entries de los últimos ${EDIT_WINDOW_DAYS} días`,
        reason: "edit_window_expired",
      },
      { status: 403 },
    );
  }

  const { error } = await supabase.from("time_entries").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
