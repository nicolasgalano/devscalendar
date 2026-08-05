import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/require-admin";
import { createProjectSchema } from "@/lib/validation/projects";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const parsed = createProjectSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, clientId, pmId, priority, jiraEnabled, slackEnabled } = parsed.data;

  // R-3: pm_id must reference a profile with role 'pm' — Postgres can't check
  // this across rows, so it's validated here in the application layer.
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

  const { data, error } = await supabase
    .from("projects")
    .insert({
      name,
      client_id: clientId,
      pm_id: pmId,
      priority,
      jira_enabled: jiraEnabled,
      slack_enabled: slackEnabled,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe un proyecto con ese nombre para este cliente" },
        { status: 409 },
      );
    }
    if (error.code === "23503") {
      return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
