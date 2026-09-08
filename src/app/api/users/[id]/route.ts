import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireAdmin } from "@/lib/api/require-admin";
import { isPm } from "@/lib/auth/roles";
import { updateUserSchema } from "@/lib/validation/users";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { supabase } = guard;
  const { id } = await params;

  const parsed = updateUserSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { roles, active, primaryPmId } = parsed.data;

  // AC-3.2 / R-3: primary_pm_id must reference a profile that *has* the 'pm'
  // role. Since 012 that is a membership question, not an equality: someone who
  // is PM and admin is a perfectly good primary PM (D-09).
  if (primaryPmId) {
    const { data: pmProfile } = await supabase
      .from("profiles")
      .select("roles")
      .eq("id", primaryPmId)
      .single();

    if (!isPm(pmProfile?.roles)) {
      return NextResponse.json(
        { error: "El PM primario debe ser un usuario con rol pm" },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({
      ...(roles !== undefined && { roles }),
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
