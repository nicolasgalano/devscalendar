import { NextResponse } from "next/server";

import { isAdmin } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import type { Database } from "@/types/database";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type ProjectRole = Database["public"]["Enums"]["project_member_role"];

/**
 * Rol que terminó otorgando acceso. `admin` y `pm` son ejes globales / del
 * proyecto; `viewer|contributor|lead` es el rol dentro del proyecto.
 * Los handlers usan esto para reglas más finas (ej: solo `lead` reasigna).
 */
export type GrantedProjectRole = "admin" | "pm" | ProjectRole;

/**
 * Rol mínimo requerido. `viewer` no aparece: cuando alcanza con leer, el
 * chequeo lo hace la RLS del `select` — no hace falta un guard.
 *
 *   - 'contributor' — admin | pm | lead | contributor.
 *   - 'lead'        — admin | pm | lead.
 *   - 'pm'          — admin | pm del proyecto (sin importar rol interno).
 */
export type MinRole = "contributor" | "lead" | "pm";

export type ProjectMembershipGuard =
  | {
      ok: true;
      supabase: SupabaseServerClient;
      userId: string;
      role: GrantedProjectRole;
    }
  | { ok: false; response: NextResponse };

/**
 * Verifica que quien llama tenga acceso al proyecto con el rol mínimo pedido.
 *
 * La autorización real la impone la RLS (policies + triggers). Este guard no
 * la reemplaza: existe para devolver un 403 con motivo legible en vez de que
 * la policy filtre en silencio y el cliente reciba un 404. Mismo patrón que
 * `requireBookingAccess`.
 *
 * **404 vs 403** (AC-6.1 del spec): cuando el proyecto no existe (o el
 * usuario no puede verlo), la respuesta es 404 — no revelar existencia. Un
 * 403 solo cuando ya sabemos que puede ver el proyecto pero no tiene rol
 * suficiente para la operación pedida.
 */
export async function requireProjectMembership(
  projectId: string,
  minRole: MinRole,
): Promise<ProjectMembershipGuard> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No autenticado" }, { status: 401 }),
    };
  }

  // D-01: la RLS ya rechaza a un usuario desactivado, pero devolvería el
  // filtro como si el proyecto no existiera → 404 falso positivo. Se traduce
  // acá a 403 con motivo.
  if (!profile.active) {
    return {
      ok: false,
      response: NextResponse.json({ error: "La cuenta está desactivada" }, { status: 403 }),
    };
  }

  const supabase = await createClient();

  // 1) Admin: acceso total, sin importar membresía.
  if (isAdmin(profile.roles)) {
    return { ok: true, supabase, userId: profile.id, role: "admin" };
  }

  // 2) PM primario del proyecto: acceso equivalente a admin dentro de este
  //    proyecto (D-8 del plan). El `select` respeta RLS: si el usuario no
  //    puede ver el proyecto, `data` es null → 404.
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

  if (project.pm_id === profile.id) {
    return { ok: true, supabase, userId: profile.id, role: "pm" };
  }

  // 3) Si el mínimo es 'pm' y no lo somos, cortamos acá.
  if (minRole === "pm") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Requiere ser admin o PM del proyecto" },
        { status: 403 },
      ),
    };
  }

  // 4) Miembro con rol suficiente.
  const { data: member } = await supabase
    .from("project_members")
    .select("role_in_project")
    .eq("project_id", projectId)
    .eq("user_id", profile.id)
    .eq("active", true)
    .maybeSingle();

  if (!member) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No sos miembro activo de este proyecto" },
        { status: 403 },
      ),
    };
  }

  const meetsMinRole =
    minRole === "contributor"
      ? member.role_in_project === "contributor" || member.role_in_project === "lead"
      : member.role_in_project === "lead";

  if (!meetsMinRole) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Requiere rol ${minRole} o superior en el proyecto` },
        { status: 403 },
      ),
    };
  }

  return { ok: true, supabase, userId: profile.id, role: member.role_in_project };
}
