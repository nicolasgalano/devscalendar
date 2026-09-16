import Link from "next/link";

import { CreateTicketButton } from "@/components/tickets/create-ticket-button";
import { EmptyState, NoResultsState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TicketList } from "@/components/tickets/ticket-list";
import { TicketListFilters } from "@/components/tickets/ticket-list-filters";
import { buttonVariants } from "@/components/ui/button";
import { getTicketFacets, type PersonFacet, type ProjectFacet } from "@/lib/tickets/facets";
import { getTicketsList } from "@/lib/tickets/query";
import {
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_OPEN,
} from "@/lib/tickets/status";
import {
  clearTicketFiltersHref,
  parseTicketFilters,
  hasActiveTicketFilters,
  type TicketFilters,
} from "@/lib/tickets/url";
import { getCurrentUser } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * "Mi trabajo" (feature 017 T1.3). Vista personal cross-project: todos los
 * tickets que la RLS le deja ver al usuario, filtrables.
 *
 * Este archivo fue `/tickets/page.tsx` en `015` T7.2 — se mudó a `/my-work`
 * cuando `017` reasignó `/tickets` (que dejó de ser un listado y hoy es solo
 * el path del detalle flat `/tickets/[ticketKey]`). El contenido es el mismo;
 * cambia el título, la descripción y algún link.
 */
export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const filters = parseTicketFilters(raw);

  const user = await getCurrentUser();
  const viewerId = user?.id ?? null;

  const [tickets, facets] = await Promise.all([
    getTicketsList(filters, viewerId),
    getTicketFacets(),
  ]);

  const active = hasActiveTicketFilters(filters);
  const canCreate = facets.projects.length > 0;

  const createButton = canCreate ? (
    <CreateTicketButton
      projects={facets.projects.map(({ id, key, name }) => ({ id, key, name }))}
      membersByProject={facets.membersByProject}
    />
  ) : null;

  return (
    <>
      <PageHeader
        title="Mi trabajo"
        description="Todos tus tickets abiertos, cross-project."
        action={tickets.length > 0 ? createButton : undefined}
      />

      <TicketListFilters
        filters={filters}
        projects={facets.projects}
        assignees={facets.assignees}
      />

      {tickets.length === 0 ? (
        active ? (
          <NoResultsState
            description={`Ningún ticket coincide con ${describeAppliedFilters(filters, facets.projects, facets.assignees)}.`}
            onClear={
              <Link
                href={clearTicketFiltersHref()}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Limpiar filtros
              </Link>
            }
          />
        ) : canCreate ? (
          <EmptyState
            title="Sin tickets"
            description="Los tickets que crees o te asignen en tus proyectos aparecen acá."
            action={createButton}
          />
        ) : (
          <EmptyState
            title="Todavía no sos miembro de ningún proyecto"
            description="Cuando un admin o un PM te sume a un proyecto, vas a ver sus tickets acá."
          />
        )
      ) : (
        <TicketList tickets={tickets} />
      )}
    </>
  );
}

function describeAppliedFilters(
  filters: TicketFilters,
  projects: ProjectFacet[],
  assignees: PersonFacet[],
): string {
  const parts: string[] = [];

  const project = projects.find((p) => p.id === filters.projectId);
  if (project) parts.push(`proyecto ${project.name}`);

  if (filters.assigneeId === "me") {
    parts.push("asignado a mí");
  } else if (filters.assigneeId === "unassigned") {
    parts.push("sin asignar");
  } else if (filters.assigneeId) {
    const person = assignees.find((p) => p.id === filters.assigneeId);
    if (person) parts.push(`asignado a ${person.name}`);
  }

  if (filters.priorities.length > 0) {
    parts.push(
      `prioridad ${filters.priorities.map((p) => TICKET_PRIORITY_LABELS[p].toLowerCase()).join(" o ")}`,
    );
  }

  if (
    filters.statuses.length !== TICKET_STATUS_OPEN.length ||
    !filters.statuses.every((status) => TICKET_STATUS_OPEN.includes(status as never))
  ) {
    parts.push(
      `estado ${filters.statuses.map((s) => TICKET_STATUS_LABELS[s].toLowerCase()).join(" o ")}`,
    );
  }

  if (filters.q) parts.push(`título con "${filters.q}"`);

  if (parts.length === 0) return "los filtros aplicados";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
}
