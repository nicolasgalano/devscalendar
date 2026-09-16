import { cache } from "react";

import { isAdmin } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import { TICKET_STATUS_OPEN } from "@/lib/tickets/status";
import type { Database } from "@/types/database";

export type ProjectListRow = {
  id: string;
  key: string;
  name: string;
  active: boolean;
  client: { id: string; name: string } | null;
  pm: { id: string; name: string } | null;
  openTicketCount: number;
};

/**
 * Proyectos visibles para el usuario, filtrados por **participación real** —
 * más restrictivo que la RLS de `projects` (que hoy es `has_any_role()` y deja
 * ver todo). La distinción importa: en `/calendar` todos pueden buscar
 * cualquier proyecto para reservar tiempo; en `/projects` (tickets) quiero
 * ver solo los proyectos donde soy admin, PM o miembro. Un dev que ve 15
 * proyectos ajenos con "0 tickets" no organiza nada.
 *
 * Reglas:
 *   - admin ve todos los proyectos activos e inactivos.
 *   - No-admin ve: los que tiene como PM primario + los que tiene fila activa
 *     en `project_members`. La unión se dedupe.
 *
 * `openTicketCount` viene de una segunda query agregada (`count` por
 * `project_id`) sobre los estados de `TICKET_STATUS_OPEN` — la RLS de tickets
 * filtra por membresía, así que si el usuario no puede ver los tickets de un
 * proyecto, el count queda en 0 (edge case improbable con las policies
 * actuales, pero anotado en `plan.md` R-5).
 *
 * Cacheada por request.
 */
export const getVisibleProjects = cache(async (): Promise<ProjectListRow[]> => {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  if (!profile) return [];

  // Base query: todos los proyectos activos + inactivos, con embeds. La RLS
  // filtra por `has_any_role` — no restringe por membresía, así que traemos
  // todo y filtramos después.
  const { data: projectsRaw } = await supabase
    .from("projects")
    .select(
      "id, key, name, active, pm_id, client:clients ( id, name ), pm:profiles!projects_pm_id_fkey ( id, full_name, email )",
    )
    .order("name", { ascending: true });

  if (!projectsRaw || projectsRaw.length === 0) return [];

  // Filtro por participación. Admin ve todo; el resto necesita ser PM primario
  // o miembro activo.
  let visible = projectsRaw;
  if (!isAdmin(profile.roles)) {
    const { data: memberRows } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", profile.id)
      .eq("active", true);

    const memberSet = new Set((memberRows ?? []).map((row) => row.project_id));
    visible = projectsRaw.filter(
      (project) => project.pm_id === profile.id || memberSet.has(project.id),
    );
  }

  if (visible.length === 0) return [];

  // Segunda query para el count de tickets abiertos. Se agrupa por project_id
  // pidiendo `id.count()` — PostgREST devuelve un array con `{project_id, count}`.
  const { data: countRows } = await supabase
    .from("tickets")
    .select("project_id, id.count()")
    .in("project_id", visible.map((project) => project.id))
    .in("status", TICKET_STATUS_OPEN as unknown as Database["public"]["Enums"]["ticket_status"][]);

  const countMap = new Map<string, number>();
  for (const row of (countRows ?? []) as unknown as Array<{
    project_id: string;
    count: number;
  }>) {
    countMap.set(row.project_id, row.count);
  }

  return visible.map((project): ProjectListRow => ({
    id: project.id,
    key: project.key,
    name: project.name,
    active: project.active,
    client: project.client ? { id: project.client.id, name: project.client.name } : null,
    pm: project.pm
      ? { id: project.pm.id, name: project.pm.full_name ?? project.pm.email }
      : null,
    openTicketCount: countMap.get(project.id) ?? 0,
  }));
});

export type ProjectDetail = {
  id: string;
  key: string;
  name: string;
  active: boolean;
  client: { id: string; name: string } | null;
  pm: { id: string; name: string } | null;
  /** Rol del usuario en el proyecto — null si no es miembro (admin/PM ajenos también quedan null). */
  roleInProject: Database["public"]["Enums"]["project_member_role"] | null;
};

/**
 * Detalle de proyecto por `key`. Usado en `/projects/[projectKey]/*`. Devuelve
 * `null` cuando la key no parsea o el proyecto no existe / no es visible por
 * la RLS.
 *
 * `roleInProject` se resuelve con la RPC del mismo nombre que ya existe (015
 * T1.5). Devuelve `null` para admin y PM primario cuando no son miembros
 * — el chequeo de permisos del cliente ya sabe que admin/PM tienen acceso
 * total sin importar el rol_in_project.
 */
/**
 * Miembro del panel de gestión (feature 015 P8). A diferencia del listado de
 * asignables del ticket (activos únicamente), acá se muestran los inactivos
 * para poder reactivarlos.
 */
export type ProjectMemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  roleInProject: Database["public"]["Enums"]["project_member_role"];
  active: boolean;
  isProjectPm: boolean;
};

/**
 * Miembros de un proyecto para el panel de gestión — activos e inactivos.
 * Ordenados por nombre; el PM primario queda arriba para que su badge se lea
 * antes que el resto. Sin `cache()` porque el panel muta datos y necesita
 * refrescar tras cada acción; el layout hace su propia query cacheada.
 */
export async function getProjectMembersDetailed(
  projectId: string,
  pmId: string | null,
): Promise<ProjectMemberRow[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("project_members")
    .select(
      "id, user_id, role_in_project, active, profiles:profiles!project_members_user_id_fkey ( full_name, email )",
    )
    .eq("project_id", projectId);

  const rows: ProjectMemberRow[] = (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.profiles?.full_name ?? row.profiles?.email ?? row.user_id,
    email: row.profiles?.email ?? "",
    roleInProject: row.role_in_project,
    active: row.active,
    isProjectPm: pmId !== null && row.user_id === pmId,
  }));

  rows.sort((a, b) => {
    if (a.isProjectPm !== b.isProjectPm) return a.isProjectPm ? -1 : 1;
    return a.name.localeCompare(b.name, "es-AR");
  });

  return rows;
}

/**
 * Usuarios activos que **todavía no** son miembros del proyecto — para el
 * autocomplete de "Agregar miembro". Filtra el PM primario también (ya es
 * miembro por el trigger `autoadd_pm_as_lead`).
 */
export async function getAddableUsers(
  currentMemberUserIds: string[],
): Promise<PersonFacet[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("active", true)
    .order("full_name", { ascending: true });

  const excluded = new Set(currentMemberUserIds);
  return (data ?? [])
    .filter((profile) => !excluded.has(profile.id))
    .map((profile) => ({
      id: profile.id,
      name: profile.full_name ?? profile.email,
    }));
}

// PersonFacet es el mismo shape que en tickets/facets.ts; se re-declara acá
// para que el panel no arrastre ese import (mismo shape, distinto dueño).
type PersonFacet = { id: string; name: string };

export const getProjectByKey = cache(async (rawKey: string): Promise<ProjectDetail | null> => {
  const { parseProjectKey } = await import("./keys");
  const key = parseProjectKey(rawKey);
  if (!key) return null;

  const supabase = await createClient();
  const profile = await getCurrentProfile();

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, key, name, active, client:clients ( id, name ), pm:profiles!projects_pm_id_fkey ( id, full_name, email )",
    )
    .eq("key", key)
    .maybeSingle();

  if (!project) return null;

  let roleInProject: ProjectDetail["roleInProject"] = null;
  if (profile) {
    const { data } = await supabase.rpc("role_in_project", {
      p_project_id: project.id,
      p_user_id: profile.id,
    });
    roleInProject = data ?? null;
  }

  return {
    id: project.id,
    key: project.key,
    name: project.name,
    active: project.active,
    client: project.client ? { id: project.client.id, name: project.client.name } : null,
    pm: project.pm
      ? { id: project.pm.id, name: project.pm.full_name ?? project.pm.email }
      : null,
    roleInProject,
  };
});
