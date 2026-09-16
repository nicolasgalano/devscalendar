import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * Datos maestros para los dropdowns de filtros. Todos pasan por RLS, así que
 * el usuario solo ve lo que puede ver.
 *
 * Proyectos: los que el usuario **puede ver** — RLS de `projects` mezcla
 * "sos admin", "sos PM primario" y "sos miembro". No hace falta filtrar
 * `active`: un proyecto desactivado sigue teniendo tickets viejos y el
 * usuario puede querer buscarlos.
 *
 * Asignables: personas activas que son miembros de algún proyecto visible.
 * Es la unión de miembros a través de todos los proyectos que el usuario ve
 * — la lista puede incluir personas que no comparten proyecto con el usuario,
 * pero sí con un ticket que él está mirando. Se dedupe por id.
 *
 * Cacheado por request para deduplicar entre `TicketListFilters` y otros
 * consumidores en la misma render pass.
 */
export type ProjectFacet = { id: string; name: string; key: string };
export type PersonFacet = { id: string; name: string };

/**
 * Miembros activos de un proyecto, para el dropdown de asignado del detalle
 * de ticket. `can_view_project` cubre admin/PM/miembro, así que la API filtra
 * lo mismo antes de aceptar el PATCH — este listado no es autoridad, es UX.
 */
export const getProjectMembers = cache(
  async (projectId: string): Promise<PersonFacet[]> => {
    const supabase = await createClient();

    const { data } = await supabase
      .from("project_members")
      .select("profiles:profiles!project_members_user_id_fkey ( id, full_name, email, active )")
      .eq("project_id", projectId)
      .eq("active", true);

    const seen = new Set<string>();
    const result: PersonFacet[] = [];
    for (const row of data ?? []) {
      const profile = row.profiles;
      if (!profile?.active) continue;
      if (seen.has(profile.id)) continue;
      seen.add(profile.id);
      result.push({ id: profile.id, name: profile.full_name ?? profile.email });
    }
    result.sort((a, b) => a.name.localeCompare(b.name, "es-AR"));
    return result;
  },
);

export const getTicketFacets = cache(
  async (): Promise<{
    projects: ProjectFacet[];
    assignees: PersonFacet[];
    /** Miembros por proyecto, para el selector de asignado del alta. */
    membersByProject: Record<string, PersonFacet[]>;
  }> => {
    const supabase = await createClient();

    const { data: projectsRaw } = await supabase
      .from("projects")
      .select("id, name, key")
      .order("name", { ascending: true });

    const projects: ProjectFacet[] = (projectsRaw ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      key: project.key,
    }));

    // Miembros activos de los proyectos visibles. RLS filtra `project_members`
    // por lo mismo (`is_project_member` incluye admin y PM primario), así que
    // esta query devuelve solo lo que el usuario puede ver.
    const { data: membersRaw } = await supabase
      .from("project_members")
      .select(
        "project_id, profiles:profiles!project_members_user_id_fkey ( id, full_name, email, active )",
      )
      .eq("active", true);

    const seen = new Set<string>();
    const assignees: PersonFacet[] = [];
    const membersByProject: Record<string, PersonFacet[]> = {};

    for (const row of membersRaw ?? []) {
      const profile = row.profiles;
      if (!profile?.active) continue;

      if (!seen.has(profile.id)) {
        seen.add(profile.id);
        assignees.push({ id: profile.id, name: profile.full_name ?? profile.email });
      }

      const bucket = (membersByProject[row.project_id] ??= []);
      if (!bucket.some((entry) => entry.id === profile.id)) {
        bucket.push({ id: profile.id, name: profile.full_name ?? profile.email });
      }
    }

    assignees.sort((a, b) => a.name.localeCompare(b.name, "es-AR"));
    for (const list of Object.values(membersByProject)) {
      list.sort((a, b) => a.name.localeCompare(b.name, "es-AR"));
    }

    return { projects, assignees, membersByProject };
  },
);
