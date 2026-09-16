import { notFound } from "next/navigation";

import { ProjectWorkspaceHeader } from "@/components/projects/project-workspace-header";
import { getProjectByKey } from "@/lib/projects/workspace";
import { getTicketFacets } from "@/lib/tickets/facets";

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
  const project = await getProjectByKey(projectKey);
  if (!project) notFound();

  const facets = await getTicketFacets();

  return (
    <>
      <ProjectWorkspaceHeader
        project={project}
        projectFacets={facets.projects}
        membersByProject={facets.membersByProject}
      />
      {children}
    </>
  );
}
