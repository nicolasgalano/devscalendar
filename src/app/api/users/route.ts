import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/require-admin";
import { createUserInviteSchema } from "@/lib/validation/users";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, userId } = guard;

  const parsed = createUserInviteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { email, role } = parsed.data;

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("email", email)
    .maybeSingle();

  // Already logged in at least once and already has a role: this is a
  // duplicate, not an invite — the admin should use PATCH /api/users/[id].
  if (existingProfile?.role) {
    return NextResponse.json({ error: "Ese usuario ya existe" }, { status: 409 });
  }

  // Logged in before but still pending (role is null): assign the role now.
  if (existingProfile) {
    const { data, error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", existingProfile.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ type: "profile", ...data }, { status: 200 });
  }

  // Never logged in: park the role in profile_invites, consumed by
  // handle_new_user() on their first Google login (see spec.md R-1).
  const { data, error } = await supabase
    .from("profile_invites")
    .upsert({ email, role, invited_by: userId })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ type: "invite", ...data }, { status: 201 });
}
