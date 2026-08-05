import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/require-admin";
import { updateUserSchema } from "@/lib/validation/users";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { supabase } = guard;
  const { id } = await params;

  const parsed = updateUserSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { role, active, primaryPmId } = parsed.data;

  // AC-3.2 / R-3: primary_pm_id must reference a profile with role 'pm'.
  if (primaryPmId) {
    const { data: pmProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", primaryPmId)
      .single();

    if (pmProfile?.role !== "pm") {
      return NextResponse.json(
        { error: "El PM primario debe ser un usuario con rol pm" },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({
      ...(role !== undefined && { role }),
      ...(active !== undefined && { active }),
      ...(primaryPmId !== undefined && { primary_pm_id: primaryPmId }),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  return NextResponse.json(data);
}
