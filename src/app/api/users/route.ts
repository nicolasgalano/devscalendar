import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireAdmin } from "@/lib/api/require-admin";
import { hasAnyRole } from "@/lib/auth/roles";
import { createUserInviteSchema } from "@/lib/validation/users";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, userId } = guard;

  const parsed = createUserInviteSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { email, roles } = parsed.data;

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id, roles")
    .eq("email", email)
    .maybeSingle();

  // Already logged in at least once and already provisioned: this is a
  // duplicate, not an invite — the admin should use PATCH /api/users/[id].
  if (hasAnyRole(existingProfile?.roles)) {
    return NextResponse.json({ error: "Ese usuario ya existe" }, { status: 409 });
  }

  // Logged in before but still pending (empty role set): assign the roles now.
  if (existingProfile) {
    const { data, error } = await supabase
      .from("profiles")
      .update({ roles })
      .eq("id", existingProfile.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ type: "profile", ...data }, { status: 200 });
  }

  // Never logged in: park the roles in profile_invites, consumed by
  // handle_new_user() on their first Google login (see spec.md R-1).
  const { data, error } = await supabase
    .from("profile_invites")
    .upsert({ email, roles, invited_by: userId })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ type: "invite", ...data }, { status: 201 });
}
