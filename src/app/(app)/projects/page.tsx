import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ProjectList } from "@/components/projects/project-list";
import { isAdmin } from "@/lib/auth/roles";
import { getVisibleProjects } from "@/lib/projects/workspace";
import { getCurrentProfile } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Raíz del sistema de tareas (feature 017 T2.4). Lista de proyectos donde el
 * usuario participa — admin ve todos, PM/miembro ven los suyos. El detalle
 * (tablero + backlog) vive en `/projects/[projectKey]/*`.
 *
 * Feature 028: le pasa al `<ProjectList>` el id del usuario y si es admin, para
 * que la columna de acciones decida por fila si mostrar el toggle "Activar/
 * Desactivar". Admin lo ve siempre; PM primario del proyecto, solo en los
 * suyos; miembros, nunca.
 */
export default async function ProjectsPage() {
  const [projects, profile] = await Promise.all([
    getVisibleProjects(),
    getCurrentProfile(),
  ]);

  // El middleware ya garantiza sesión bajo `(app)/`, pero el narrowing lo pide.
  if (!profile) {
    return (
      <>
        <PageHeader title="Proyectos" />
        <EmptyState
          title="Sesión no disponible"
          description="Volvé a iniciar sesión para ver tus proyectos."
        />
      </>
    );
  }

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
        <ProjectList
          projects={projects}
          currentUserId={profile.id}
          isAdmin={isAdmin(profile.roles)}
        />
      )}
    </>
  );
}
