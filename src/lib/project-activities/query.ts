import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type ProjectActivity = {
  id: string;
  projectId: string;
  name: string;
  active: boolean;
  createdAt: string;
};

/**
 * Actividades del proyecto (016 T3.4). Por default trae solo las activas —
 * el panel de gestión pasa `includeInactive: true` para mostrar todo con
 * toggles de reactivar.
 */
export const getActivitiesForProject = cache(
  async (
    projectId: string,
    { includeInactive = false }: { includeInactive?: boolean } = {},
  ): Promise<ProjectActivity[]> => {
    const supabase = await createClient();
    let query = supabase
      .from("project_activities")
      .select("id, project_id, name, active, created_at")
      .eq("project_id", projectId)
      .order("active", { ascending: false }) // activas primero
      .order("name", { ascending: true });
    if (!includeInactive) query = query.eq("active", true);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      active: row.active,
      createdAt: row.created_at,
    }));
  },
);
