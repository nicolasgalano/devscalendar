import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireProjectMembership } from "@/lib/api/require-project-membership";
import { createActivitySchema } from "@/lib/validation/project-activities";

/**
 * Alta de actividad de proyecto (016 T2.7). Solo admin o PM del proyecto.
 * Traduce el unique violation (`project_activities_name_active_idx`) a 409
 * con motivo — es común intentar agregar "QA" cuando ya está.
 */
export async function POST(request: Request) {
  const parsed = createActivitySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const guard = await requireProjectMembership(parsed.data.project_id, "pm");
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const { data, error } = await supabase
    .from("project_activities")
    .insert({ project_id: parsed.data.project_id, name: parsed.data.name })
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

  return NextResponse.json(data, { status: 201 });
}
