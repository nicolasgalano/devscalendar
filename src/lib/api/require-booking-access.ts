import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type BookingGuard =
  | { ok: true; supabase: SupabaseServerClient; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Verifica que quien llama pueda administrar las reservas de un proyecto: el
 * admin, o el PM responsable de ese proyecto (spec funcional §3).
 *
 * La autorización real la impone la RLS — este guard no la reemplaza. Existe
 * para devolver un 403 con un motivo legible: sin él, la policy filtraría la
 * fila y la API respondería "no encontrado", mandando al PM a buscar un
 * problema de datos que en realidad es de permisos.
 */
export async function requireBookingAccess(projectId: string): Promise<BookingGuard> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No autenticado" }, { status: 401 }),
    };
  }

  const supabase = await createClient();

  if (profile.role === "admin") {
    return { ok: true, supabase, userId: profile.id };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("pm_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 }),
    };
  }

  if (project.pm_id !== profile.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Solo el PM responsable del proyecto puede administrar sus reservas" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, supabase, userId: profile.id };
}
