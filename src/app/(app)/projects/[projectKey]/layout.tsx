import { notFound } from "next/navigation";

import { ProjectWorkspaceHeader } from "@/components/projects/project-workspace-header";
import { isAdmin } from "@/lib/auth/roles";
import { getProjectByKey } from "@/lib/projects/workspace";
import { getTicketFacets } from "@/lib/tickets/facets";
import { getCurrentProfile } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Shell del workspace de proyecto (feature 017 T2.7). Se renderiza para
 * `/projects/[projectKey]/board` y `/projects/[projectKey]/backlog`. La misma
 * `getProjectByKey` se cachea por request — la usan `page.tsx` y las child
 * pages sin re-fetchear.
 *
 * Si el proyecto no existe (RLS lo filtra o key inválida) → `notFound()`.
 */
export default async function ProjectWorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ projectKey: string }>;
  children: React.ReactNode;
}) {
  const { projectKey } = await params;
  const [project, profile] = await Promise.all([
    getProjectByKey(projectKey),
    getCurrentProfile(),
  ]);
  if (!project) notFound();

  const facets = await getTicketFacets();

  // 015 T8.3: gestión de miembros solo para admin o PM del proyecto. Los
  // `lead` NO administran miembros a propósito — la decisión de agregar o
  // sacar gente del proyecto la mantiene el PM primario, que es quien rinde
  // cuentas por él.
  const canManageMembers = Boolean(
    profile && (isAdmin(profile.roles) || project.pm?.id === profile.id),
  );

  return (
    <>
      <ProjectWorkspaceHeader
        project={project}
        projectFacets={facets.projects}
        membersByProject={facets.membersByProject}
        canManageMembers={canManageMembers}
      />
      {children}
    </>
  );
}
