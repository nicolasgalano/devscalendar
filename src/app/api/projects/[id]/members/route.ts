import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/session";

// GET /api/projects/[id]/members?q=<term>
//
// Devuelve hasta 8 miembros activos del proyecto que matcheen el término
// (contains, case-insensitive) sobre `full_name` o `email`. Consumido por
// el autocompletado de `@` mention del editor rich text (022).
//
// Autorización: RLS de `project_members` + `profiles` (spec AC-1.4/1.5).
// Cualquier viewer del proyecto puede listar. Si el proyecto no existe o
// no es visible, respondemos 404 sin distinguir (patrón AC-6.1 de 015).

const RESULT_CAP = 8;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const supabase = await createClient();

  // Chequeo de visibilidad primero — sin esto un proyecto invisible
  // devolvería [] sin distinguir de "sin matches", y el cliente se
  // quedaría intentando autocompletar contra un proyecto que no existe.
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();

  let membersQuery = supabase
    .from("project_members")
    .select("profile:profiles!inner(id, full_name, email, avatar_url, active)")
    .eq("project_id", projectId)
    .eq("active", true)
    .eq("profile.active", true);

  if (query) {
    // Escape del `%` y `,` que PostgREST usa para separar filtros en `or`.
    // Un usuario que tipea "ni%" no debería explotar la query.
    const safe = query.replace(/[%,]/g, "");
    if (safe.length > 0) {
      membersQuery = membersQuery.or(
        `full_name.ilike.%${safe}%,email.ilike.%${safe}%`,
        { referencedTable: "profiles" },
      );
    }
  }

  const { data, error } = await membersQuery
    .order("full_name", { referencedTable: "profiles", ascending: true })
    .limit(RESULT_CAP);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? [])
    .map((row) => row.profile)
    .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
    .map((profile) => ({
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      avatar_url: profile.avatar_url,
    }));

  return NextResponse.json(rows);
}
