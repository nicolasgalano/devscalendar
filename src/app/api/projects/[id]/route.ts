import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/require-admin";
import { updateProjectSchema } from "@/lib/validation/projects";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { supabase } = guard;
  const { id } = await params;

  const parsed = updateProjectSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, pmId, priority, jiraEnabled, slackEnabled, active } = parsed.data;

  // R-3: pm_id must reference a profile with role 'pm'.
  if (pmId !== undefined) {
    const { data: pmProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", pmId)
      .single();

    if (pmProfile?.role !== "pm") {
      return NextResponse.json(
        { error: "El PM responsable debe ser un usuario con rol pm" },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from("projects")
    .update({
      ...(name !== undefined && { name }),
      ...(pmId !== undefined && { pm_id: pmId }),
      // Changing priority is what fires the audit_log trigger (T1.3).
      ...(priority !== undefined && { priority }),
      ...(jiraEnabled !== undefined && { jira_enabled: jiraEnabled }),
      ...(slackEnabled !== undefined && { slack_enabled: slackEnabled }),
      ...(active !== undefined && { active }),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe un proyecto con ese nombre para este cliente" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  return NextResponse.json(data);
}
