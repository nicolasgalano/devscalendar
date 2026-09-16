import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireProjectMembership } from "@/lib/api/require-project-membership";
import { createSprintSchema } from "@/lib/validation/sprints";
import type { Database } from "@/types/database";

/**
 * Alta de sprint (018 T2.3). Guard: admin o PM del proyecto (`requireProjectMembership`
 * con `minRole: 'pm'`). `numero` lo pone el trigger `assign_sprint_number`;
 * el cast a `Insert` es el mismo patrón de 015 T5.1 — el codegen no ve
 * triggers y marca la columna como required.
 *
 * El sprint nace `planned` por el default de tabla. Activar es un PATCH aparte
 * (T2.4). Cerrar es un endpoint dedicado (T2.5).
 */
export async function POST(request: Request) {
  const parsed = createSprintSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { project_id, name, goal, starts_at, ends_at } = parsed.data;

  const guard = await requireProjectMembership(project_id, "pm");
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const insertPayload = {
    project_id,
    name,
    goal,
    starts_at,
    ends_at,
  };

  const { data, error } = await supabase
    .from("sprints")
    .insert(insertPayload as unknown as Database["public"]["Tables"]["sprints"]["Insert"])
    .select("*")
    .single();

  if (error) {
    if (error.code === "23503") {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }
    if (error.code === "23514") {
      // Cae acá sprints_dates_ok si por algún motivo el schema Zod no lo pescó
      // (defensivo, no debería pasar).
      return NextResponse.json(
        { error: "Datos del sprint inválidos", reason: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
