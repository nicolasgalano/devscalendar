import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireAdmin } from "@/lib/api/require-admin";
import { isPm } from "@/lib/auth/roles";
import { deriveProjectKey } from "@/lib/projects/keys";
import { createProjectSchema } from "@/lib/validation/projects";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const parsed = createProjectSchema.safeParse(await readJsonBody(request));
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
    .select("roles")
    .eq("id", pmId)
    .single();

  if (!isPm(pmProfile?.roles)) {
    return NextResponse.json(
      { error: "El PM responsable debe ser un usuario con rol pm" },
      { status: 400 },
    );
  }

  // `key` se deriva del nombre hasta que T8.1 agregue el input explícito en el
  // form de admin. La derivación replica el backfill de la migration 14.
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name,
      key: deriveProjectKey(name),
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
      // Dos unique constraints: (client_id, name) por proyecto/cliente, y (key)
      // global. Distinguir por el nombre del constraint que dispara el error.
      if (error.message?.includes("projects_key_unique")) {
        return NextResponse.json(
          {
            error:
              "La clave derivada del nombre ya está en uso por otro proyecto. Ajustá el nombre para que las primeras letras sean distintas.",
          },
          { status: 409 },
        );
      }
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
