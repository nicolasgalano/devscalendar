import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireProjectMembership } from "@/lib/api/require-project-membership";
import { createClient } from "@/lib/supabase/server";
import { updateActivitySchema } from "@/lib/validation/project-activities";

/**
 * PATCH de actividad (016 T2.7). Cambio de nombre o toggle activo.
 * Traduce el unique violation a 409 con reason.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = updateActivitySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const readClient = await createClient();
  const { data: activity } = await readClient
    .from("project_activities")
    .select("id, project_id")
    .eq("id", id)
    .maybeSingle();

  if (!activity) {
    return NextResponse.json({ error: "Actividad no encontrada" }, { status: 404 });
  }

  const guard = await requireProjectMembership(activity.project_id, "pm");
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const { data, error } = await supabase
    .from("project_activities")
    .update({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.active !== undefined && { active: parsed.data.active }),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error: "Ya hay una actividad activa con ese nombre en el proyecto",
          reason: "duplicate_name",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
