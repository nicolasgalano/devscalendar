import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ProjectList } from "@/components/projects/project-list";
import { getVisibleProjects } from "@/lib/projects/workspace";

export const dynamic = "force-dynamic";

/**
 * Raíz del sistema de tareas (feature 017 T2.4). Lista de proyectos donde el
 * usuario participa — admin ve todos, PM/miembro ven los suyos. El detalle
 * (tablero + backlog) vive en `/projects/[projectKey]/*`.
 */
export default async function ProjectsPage() {
  const projects = await getVisibleProjects();

  return (
    <>
      <PageHeader
        title="Proyectos"
        description="Elegí un proyecto para ver su tablero o su backlog."
      />

      {projects.length === 0 ? (
        <EmptyState
          title="Todavía no participás en ningún proyecto"
          description="Cuando un admin o un PM te sume a un proyecto, vas a poder ver su tablero y sus tickets acá."
        />
      ) : (
        <ProjectList projects={projects} />
      )}
    </>
  );
}
