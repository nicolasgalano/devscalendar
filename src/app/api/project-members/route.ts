import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireProjectMembership } from "@/lib/api/require-project-membership";
import { createMemberSchema } from "@/lib/validation/tickets";

/**
 * Alta de miembro de proyecto. Solo admin y PM primario pueden agregar
 * (AC-1.1 del spec, policy `project_members: admin/PM insert`).
 *
 * `active = true` por default. Reactivar a alguien que ya fue miembro alguna
 * vez se hace con PATCH; este endpoint no upserts a propósito, para evitar
 * que un admin "agregue de nuevo" a alguien y sin querer le baje el rol de
 * `lead` a `contributor`.
 */
export async function POST(request: Request) {
  const parsed = createMemberSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { project_id, user_id, role_in_project } = parsed.data;

  const guard = await requireProjectMembership(project_id, "pm");
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const { data, error } = await supabase
    .from("project_members")
    .insert({ project_id, user_id, role_in_project })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Ya existía (activo o no). El caller que quiere "reactivar" tiene que
      // usar PATCH sobre el id existente — el mensaje se lo indica.
      return NextResponse.json(
        {
          error: "Ese usuario ya es (o fue) miembro del proyecto. Usá PATCH para reactivarlo.",
        },
        { status: 409 },
      );
    }
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Referencia inválida (proyecto o usuario)" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
