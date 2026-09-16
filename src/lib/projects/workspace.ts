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
