import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { isAdmin } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import { createTimeEntrySchema } from "@/lib/validation/time-entries";
import type { Database } from "@/types/database";

/**
 * Alta de time entry (016 T2.2). Guards en cascada:
 *   1. Profile activo y con al menos un rol.
 *   2. Si `logged_at` > hoy → 400.
 *   3. `ticket_id` pertenece al mismo `project_id` (si viene).
 *   4. `activity_id` pertenece al mismo `project_id` Y está activa (si viene).
 *   5. Si el proyecto tiene ≥1 actividad activa y `activity_id` viene null →
 *      400 con `reason: 'activity_required'` (AC-1.5).
 *   6. Insert — la RLS decide si el user es contributor+ (self) o admin/PM/
 *      lead (para otros). Si el `user_id` viene ≠ auth.uid(), la RLS aplica
 *      la policy "insert for others".
 *
 * El trigger `notify_time_entry_events` dispara el aviso "cargaron por vos"
 * si `created_by ≠ user_id`.
 */
export async function POST(request: Request) {
  const parsed = createTimeEntrySchema.safeParse(await readJsonBody(request));
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

  const { project_id, ticket_id, activity_id, minutes, logged_at, description } =
    parsed.data;
  const target_user_id = parsed.data.user_id ?? profile.id;

  // Guard 2: logged_at no puede ser futuro.
  const today = new Date().toISOString().slice(0, 10);
  if (logged_at > today) {
    return NextResponse.json(
      { error: "No se puede cargar tiempo en el futuro", reason: "future_date" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // Guard 3: ticket ↔ project match.
  if (ticket_id) {
    const { data: ticket } = await supabase
      .from("tickets")
      .select("project_id")
      .eq("id", ticket_id)
      .maybeSingle();
    if (!ticket) {
      return NextResponse.json({ error: "Ticket no encontrado" }, { status: 400 });
    }
    if (ticket.project_id !== project_id) {
      return NextResponse.json(
        { error: "El ticket pertenece a otro proyecto" },
        { status: 400 },
      );
    }
  }

  // Guard 4: activity ↔ project match + active.
  if (activity_id) {
    const { data: activity } = await supabase
      .from("project_activities")
      .select("project_id, active")
      .eq("id", activity_id)
      .maybeSingle();
    if (!activity) {
      return NextResponse.json({ error: "Actividad no encontrada" }, { status: 400 });
    }
    if (activity.project_id !== project_id) {
      return NextResponse.json(
        { error: "La actividad pertenece a otro proyecto" },
        { status: 400 },
      );
    }
    if (!activity.active) {
      return NextResponse.json(
        { error: "La actividad está desactivada", reason: "activity_inactive" },
        { status: 400 },
      );
    }
  }

  // Guard 5: si el proyecto tiene actividades activas, exigir activity_id.
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

  // Chequeo defensivo de proyecto activo (AC-1.6). Un proyecto inactivo no
  // acepta cargas nuevas, aunque sí edición de las viejas.
  const { data: project } = await supabase
    .from("projects")
    .select("active")
    .eq("id", project_id)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 400 });
  }
  if (!project.active && !isAdmin(profile.roles)) {
    return NextResponse.json(
      { error: "Ese proyecto está desactivado", reason: "project_inactive" },
      { status: 409 },
    );
  }

  // Insert. La RLS decide entre las dos policies (self vs for-others).
  const insertPayload = {
    user_id: target_user_id,
    created_by: profile.id,
    project_id,
    ticket_id: ticket_id ?? null,
    activity_id: activity_id ?? null,
    minutes,
    logged_at,
    description: description ?? null,
  };

  const { data, error } = await supabase
    .from("time_entries")
    .insert(insertPayload as Database["public"]["Tables"]["time_entries"]["Insert"])
    .select("*")
    .single();

  if (error) {
    if (error.code === "23514") {
      return NextResponse.json(
        { error: "Datos inválidos", reason: error.message },
        { status: 400 },
      );
    }
    // La RLS rechaza en silencio; el insert devuelve error sin data. Cae acá.
    return NextResponse.json(
      { error: error.message, reason: "insert_denied" },
      { status: error.code === "42501" ? 403 : 500 },
    );
  }

  return NextResponse.json(data, { status: 201 });
}
