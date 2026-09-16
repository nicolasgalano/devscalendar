import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState, NoResultsState } from "@/components/empty-state";
import { TicketList } from "@/components/tickets/ticket-list";
import { TicketListFilters } from "@/components/tickets/ticket-list-filters";
import { buttonVariants } from "@/components/ui/button";
import { getProjectByKey } from "@/lib/projects/workspace";
import { getTicketFacets } from "@/lib/tickets/facets";
import { getTicketsList } from "@/lib/tickets/query";
import {
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_OPEN,
} from "@/lib/tickets/status";
import {
  hasActiveTicketFilters,
  parseTicketFilters,
  type TicketFilters,
} from "@/lib/tickets/url";
import { getCurrentUser } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Tab "Backlog" del workspace del proyecto (feature 017 T4.2). Reuso de
 * `<TicketList>` scopeado al proyecto — el filtro `projectId` se aplica
 * siempre y se esconde del panel con `hideProjectFilter` (redundante en este
 * contexto).
 *
 * El `basePath` del filtro apunta a la ruta actual, así los `<Link>` que
 * cambia el estado del URL se quedan en el backlog en vez de saltar a
 * `/my-work`.
 */
export default async function BacklogPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectKey } = await params;
  const raw = await searchParams;

  const project = await getProjectByKey(projectKey);
  if (!project) notFound();

  // Los filtros del URL se leen igual que en `/my-work`, y sobreescribimos
  // `projectId` con el fijo del path — así `?projectId=<otro>` en el URL no
  // rompe el scope.
  const parsed = parseTicketFilters(raw);
  const filters: TicketFilters = { ...parsed, projectId: project.id };

  const user = await getCurrentUser();
  const viewerId = user?.id ?? null;

  const [tickets, facets] = await Promise.all([
    getTicketsList(filters, viewerId),
    getTicketFacets(),
  ]);

  // "Activo" en este contexto = algún filtro ADEMÁS del `projectId` fijo.
  // `hasActiveTicketFilters` mira todos los filtros, incluido `projectId`, y
  // como acá siempre está seteado, tenemos que restar esa dimensión a mano.
  const withoutProject: TicketFilters = { ...filters, projectId: null };
  const active = hasActiveTicketFilters(withoutProject);

  const basePath = `/projects/${projectKey}/backlog`;

  return (
    <>
      <TicketListFilters
        filters={filters}
        projects={facets.projects}
        assignees={facets.assignees}
        basePath={basePath}
        hideProjectFilter
      />

      {tickets.length === 0 ? (
        active ? (
          <NoResultsState
            description={`Ningún ticket del proyecto ${project.name} coincide con ${describeAppliedFilters(withoutProject, facets.assignees)}.`}
            onClear={
              <Link
                href={basePath}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Limpiar filtros
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="Sin tickets en este proyecto"
            description="Los tickets que crees o te asignen en este proyecto van a aparecer acá."
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
  assignees: { id: string; name: string }[],
): string {
  const parts: string[] = [];

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
