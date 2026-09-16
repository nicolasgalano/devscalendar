import { notFound, redirect } from "next/navigation";

import { ProjectMembersPanel } from "@/components/projects/project-members-panel";
import { isAdmin } from "@/lib/auth/roles";
import {
  getAddableUsers,
  getProjectByKey,
  getProjectMembersDetailed,
} from "@/lib/projects/workspace";
import { getCurrentProfile } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Tab "Miembros" del workspace del proyecto (feature 015 P8, T8.2).
 *
 * Guard duplicado — el layout ya esconde el tab del nav, pero un URL directo
 * llega igual. Acá redirige a `/board` cuando el usuario no es admin ni PM.
 * Sin esto, un contributor con la URL en el portapapeles vería el panel y
 * los PATCH le rebotarían del server (403), lo que se lee como bug.
 */
export default async function ProjectMembersPage({
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
    redirect(`/projects/${projectKey}/board`);
  }

  const members = await getProjectMembersDetailed(project.id, project.pm?.id ?? null);
  const addable = await getAddableUsers(members.map((m) => m.userId));

  return <ProjectMembersPanel members={members} addable={addable} projectId={project.id} />;
}
