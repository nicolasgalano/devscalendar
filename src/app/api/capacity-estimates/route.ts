import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireProjectMembership } from "@/lib/api/require-project-membership";
import { upsertCapacityEstimateSchema } from "@/lib/validation/capacity-estimates";

/**
 * Feature 029: upsert de una estimación de capacidad.
 *
 * Endpoint único para crear y actualizar — la unicidad `(project_id, dev_id,
 * date)` deja que el cliente no tenga que elegir entre POST y PATCH mirando
 * primero si existe la fila. Si existe, actualiza `hours`; si no, inserta.
 *
 * Autorización en dos capas:
 *   - Guard de ruta: `requireProjectMembership(projectId, 'pm')` — admin O
 *     PM primario. Responde 401/403 antes de llamar la RPC.
 *   - RPC `security definer`: revalida con `has_role` (que incluye `and active`
 *     por D-01) + chequea proyecto activo + dev miembro. Defense in depth
 *     por el mismo motivo que `reallocate_booking` (ADR 0010): una RLS que
 *     filtra en silencio no es una respuesta de error.
 *
 * Códigos de la RPC → HTTP:
 *   - DC004 → 400 (proyecto no encontrado o desactivado)
 *   - DC011 → 400 (horas fuera de rango)
 *   - DC012 → 400 (dev no es miembro activo)
 *   - 42501 → 403 (sin permiso, aunque el guard ya debería atajarlo antes)
 */
export async function POST(request: Request) {
  const parsed = upsertCapacityEstimateSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const guard = await requireProjectMembership(parsed.data.projectId, "pm");
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase.rpc("upsert_capacity_estimate", {
    p_project_id: parsed.data.projectId,
    p_dev_id: parsed.data.devId,
    p_date: parsed.data.date,
    p_hours: parsed.data.hours,
  });

  if (error) {
    switch (error.code) {
      case "DC004":
        return NextResponse.json(
          { error: "Proyecto no encontrado o desactivado" },
          { status: 400 },
        );
      case "DC011":
        return NextResponse.json(
          { error: "Las horas estimadas deben estar entre 0.25 y 24" },
          { status: 400 },
        );
      case "DC012":
        return NextResponse.json(
          { error: "El desarrollador no es miembro activo del proyecto" },
          { status: 400 },
        );
      case "42501":
        return NextResponse.json(
          { error: "Solo admin o PM primario puede cargar estimaciones" },
          { status: 403 },
        );
      default:
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ estimate: data });
}
