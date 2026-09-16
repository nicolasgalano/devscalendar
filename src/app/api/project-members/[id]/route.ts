import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireProjectMembership } from "@/lib/api/require-project-membership";
import { createClient } from "@/lib/supabase/server";
import { updateMemberSchema } from "@/lib/validation/tickets";

/**
 * PATCH de miembro: cambiar rol o desactivar/reactivar.
 *
 * El guard necesita el `project_id`, que se lee primero desde el member.
 * Igual que en `PATCH /api/bookings/:id`, la lectura respeta RLS: si el que
 * llama no puede ver ese member, el select devuelve `null` → 404.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = updateMemberSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const reader = await createClient();
  const { data: member } = await reader
    .from("project_members")
    .select("project_id")
    .eq("id", id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Miembro no encontrado" }, { status: 404 });
  }

  const guard = await requireProjectMembership(member.project_id, "pm");
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const { data, error } = await supabase
    .from("project_members")
    .update({
      ...(parsed.data.role_in_project !== undefined && {
        role_in_project: parsed.data.role_in_project,
      }),
      ...(parsed.data.active !== undefined && { active: parsed.data.active }),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "No tenés permiso para editar este miembro" },
      { status: 403 },
    );
  }

  return NextResponse.json(data);
}
