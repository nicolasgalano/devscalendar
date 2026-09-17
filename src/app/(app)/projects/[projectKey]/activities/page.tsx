import { notFound, redirect } from "next/navigation";

import { ProjectActivitiesPanel } from "@/components/projects/project-activities-panel";
import { isAdmin } from "@/lib/auth/roles";
import { getActivitiesForProject } from "@/lib/project-activities/query";
import { getProjectByKey } from "@/lib/projects/workspace";
import { getCurrentProfile } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Tab "Actividades" del workspace de proyecto (016 T5.2).
 *
 * Guard doble — el layout esconde el tab del nav (T5.4), pero un URL directo
 * llega igual. Acá redirige a `/sprint` cuando el viewer no es admin ni PM.
 * Sin (b), el panel se vería pero los PATCH rebotan del server 403.
 */
export default async function ProjectActivitiesPage({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;

  const [project, profile] = await Promise.all([
    getProjectByKey(projectKey),
    getCurrentProfile(),
  ]);
  if (!project) notFound();

  const canManage = Boolean(
    profile && (isAdmin(profile.roles) || project.pm?.id === profile.id),
  );
  if (!canManage) {
    redirect(`/projects/${projectKey}/sprint`);
  }

  const activities = await getActivitiesForProject(project.id, {
    includeInactive: true,
  });

  return <ProjectActivitiesPanel activities={activities} projectId={project.id} />;
}
