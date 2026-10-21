import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireProjectMembership } from "@/lib/api/require-project-membership";
import { setProjectActiveSchema } from "@/lib/validation/projects";

/**
 * Feature 028: toggle de `projects.active` para admin **o PM primario**.
 *
 * El PATCH clásico (`/api/projects/[id]`) sigue siendo admin-only para que no
 * crezca y termine aceptando cambios de nombre/PM por el PM primario. Esta
 * ruta aparte expresa un permiso distinto: la operación "cerrar o reabrir el
 * proyecto" es simétrica entre admin y PM, y las dos pasan por la misma RPC
 * `set_project_active` que vive en SQL (patrón ADR 0010, porque la policy
 * `projects: admin write` filtra al PM en silencio).
 *
 * Códigos de la RPC:
 *   - `DC010` → proyecto no encontrado (404)
 *   - `42501` → sin permiso (403, aunque el guard de abajo ya lo ataja antes)
 *
 * Si `requireProjectMembership(id, 'pm')` ya respondió 403/404, nunca llegamos
 * a la RPC — el chequeo de autorización está en dos capas por el mismo motivo
 * que en `reallocate_booking`: una RLS que filtra en silencio no es una
 * respuesta de error, es una fila que no aparece.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const guard = await requireProjectMembership(id, "pm");
  if (!guard.ok) return guard.response;

  const parsed = setProjectActiveSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data, error } = await guard.supabase.rpc("set_project_active", {
    p_project_id: id,
    p_active: parsed.data.active,
  });

  if (error) {
    if (error.code === "DC010") {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }
    if (error.code === "42501") {
      return NextResponse.json(
        { error: "Solo admin o PM primario puede cambiar el estado" },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ active: data });
}
