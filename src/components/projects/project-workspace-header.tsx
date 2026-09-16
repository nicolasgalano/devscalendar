"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CreateTicketButton } from "@/components/tickets/create-ticket-button";
import type { ProjectDetail } from "@/lib/projects/workspace";
import type { PersonFacet, ProjectFacet } from "@/lib/tickets/facets";
import { cn } from "@/lib/utils";

/**
 * Header compartido entre `/projects/[projectKey]/board` y `/projects/[projectKey]/backlog`
 * (feature 017 T2.6). Breadcrumb + KEY + cliente/PM, acción primaria (Crear
 * ticket) y tabs "Tablero" / "Backlog".
 *
 * El activo de las tabs se determina por segmento final del path — igual
 * criterio que el nav del sidebar. Sin esto, o se marcan las dos o ninguna.
 */
export function ProjectWorkspaceHeader({
  project,
  projectFacets,
  membersByProject,
  canManageMembers = false,
}: {
  project: ProjectDetail;
  projectFacets: ProjectFacet[];
  membersByProject: Record<string, PersonFacet[]>;
  /** Solo admin o PM del proyecto — determina si aparece el tab "Miembros". */
  canManageMembers?: boolean;
}) {
  const pathname = usePathname();
  const currentTab: "board" | "backlog" | "members" = pathname.endsWith("/members")
    ? "members"
    : pathname.endsWith("/backlog")
      ? "backlog"
      : "board";

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <nav aria-label="Ubicación" className="text-caption text-muted-foreground mb-1">
            <Link href="/projects" className="hover:underline">
              Proyectos
            </Link>
            <span aria-hidden="true"> › </span>
            <span className="font-data">{project.key}</span>
          </nav>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-title font-medium">{project.name}</h1>
            {!project.active && (
              <span className="text-caption text-muted-foreground">(inactivo)</span>
            )}
          </div>
          <p className="text-ui text-muted-foreground mt-1">
            {project.client && (
              <>
                <span>{project.client.name}</span>
                <span aria-hidden="true"> · </span>
              </>
            )}
            {project.pm && <span>PM: {project.pm.name}</span>}
          </p>
        </div>

        {/* La acción primaria del workspace: crear un ticket con el proyecto
            ya elegido. `CreateTicketButton` respeta `?projectId=` en el URL,
            pero acá va explícito para que el pathname no importe. */}
        {project.active && (
          <CreateTicketButton
            projects={projectFacets}
            membersByProject={membersByProject}
            defaultProjectId={project.id}
          />
        )}
      </div>

      <nav aria-label="Vistas del proyecto" className="border-border flex gap-4 border-b">
        <TabLink
          href={`/projects/${project.key}/board`}
          active={currentTab === "board"}
          label="Tablero"
        />
        <TabLink
          href={`/projects/${project.key}/backlog`}
          active={currentTab === "backlog"}
          label="Backlog"
        />
        {canManageMembers && (
          <TabLink
            href={`/projects/${project.key}/members`}
            active={currentTab === "members"}
            label="Miembros"
          />
        )}
      </nav>
    </div>
  );
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-ui focus-visible:outline-ring -mb-px border-b-2 px-1 py-2 outline-none",
        "focus-visible:outline-2 focus-visible:-outline-offset-2",
        active
          ? "border-primary text-primary font-medium"
          : "text-secondary-foreground hover:text-foreground border-transparent",
      )}
    >
      {label}
    </Link>
  );
}
