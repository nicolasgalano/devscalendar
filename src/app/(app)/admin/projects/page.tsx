import { createClient } from "@/lib/supabase/server";

import { ProjectsTable } from "./projects-table";

export const dynamic = "force-dynamic";

export default async function AdminProjectsPage() {
  const supabase = await createClient();

  const [projectsResult, clientsResult, pmsResult] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, priority, jira_enabled, slack_enabled, active, client:clients(id, name), pm:profiles!projects_pm_id_fkey(id, full_name, email)",
      )
      .order("name"),
    supabase.from("clients").select("id, name").eq("active", true).order("name"),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "pm")
      .eq("active", true)
      .order("full_name"),
  ]);

  // §9: el estado de error se propaga al error boundary de la ruta.
  const failure = projectsResult.error ?? clientsResult.error ?? pmsResult.error;
  if (failure) throw new Error(failure.message);

  return (
    <ProjectsTable
      projects={projectsResult.data ?? []}
      clients={clientsResult.data ?? []}
      pms={pmsResult.data ?? []}
    />
  );
}
