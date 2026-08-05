import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/require-admin";
import { updateClientSchema } from "@/lib/validation/clients";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { supabase } = guard;
  const { id } = await params;

  const parsed = updateClientSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, active, confirmDeactivateWithActiveProjects } = parsed.data;

  // AC-1.2: deactivating a client with active projects needs an explicit
  // confirmation instead of being blocked outright.
  if (active === false && !confirmDeactivateWithActiveProjects) {
    const { count, error: countError } = await supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .eq("active", true);

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    if (count && count > 0) {
      return NextResponse.json(
        {
          error: "Este cliente tiene proyectos activos. Confirmá la desactivación.",
          requiresConfirmation: true,
          activeProjectsCount: count,
        },
        { status: 409 },
      );
    }
  }

  const { data, error } = await supabase
    .from("clients")
    .update({ ...(name !== undefined && { name }), ...(active !== undefined && { active }) })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe un cliente con ese nombre" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  return NextResponse.json(data);
}
