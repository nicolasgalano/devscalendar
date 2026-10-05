import Link from "next/link";
import { MessageSquareIcon } from "lucide-react";

import { TicketPriorityBadge } from "@/components/tickets/ticket-priority";
import { TicketRowSprintControls } from "@/components/tickets/ticket-row-sprint-controls";
import { TicketStatusBadge } from "@/components/tickets/ticket-status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SprintListItem } from "@/lib/sprints/query";
import { formatSprintDisplayName } from "@/lib/sprints/status";
import { formatAbsoluteFull, formatRelativeShort } from "@/lib/tickets/relative-time";
import type { TicketListItem } from "@/lib/tickets/query";

/**
 * DESIGN.md §7: la fila es la unidad de navegación. Cada fila es un `<Link>`
 * sobre la clave, y el resto de las celdas heredan el mismo href para que
 * clickear en cualquier parte de la fila abra el detalle. La `Key` va en
 * `.font-data` con `--primary` (§4, es link) — es el identificador estable
 * que el usuario aprende a leer.
 *
 * **018:** dos columnas nuevas — Sprint (nombre del sprint o "Backlog") y
 * Est. hs (horas estimadas o "—"). Cuando la lista recibe `sprintControls`,
 * ambas se vuelven editables con `<TicketRowSprintControls>` para admin, PM
 * y lead. Sin `sprintControls` (por ejemplo en `/my-work`, cross-project),
 * quedan de solo lectura.
 */
export type SprintControls = {
  /** Sprints disponibles (no cerrados) del proyecto. */
  openSprints: SprintListItem[];
  /** true = admin/PM/lead, false o undefined = readonly */
  canPlan: boolean;
};

export function TicketList({
  tickets,
  sprintControls,
}: {
  tickets: TicketListItem[];
  sprintControls?: SprintControls;
}) {
  const showSprintControls = Boolean(sprintControls?.canPlan);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">Clave</TableHead>
          <TableHead>Título</TableHead>
          <TableHead className="w-36">Estado</TableHead>
          <TableHead className="w-28">Prioridad</TableHead>
          <TableHead className="w-40">Asignado</TableHead>
          <TableHead className="w-32">Sprint</TableHead>
          <TableHead className="w-24 text-right">Est. hs</TableHead>
          <TableHead className="w-32 text-right">Actualizado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.map((ticket) => (
          <TicketRow
            key={ticket.id}
            ticket={ticket}
            sprintControls={showSprintControls ? sprintControls : undefined}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function TicketRow({
  ticket,
  sprintControls,
}: {
  ticket: TicketListItem;
  sprintControls?: SprintControls;
}) {
  const href = `/tickets/${ticket.key}`;
  return (
    <TableRow className="hover:bg-surface-hover">
      <TableCell className="font-data text-primary">
        <Link
          href={href}
          className="focus-visible:outline-ring rounded-sm outline-none focus-visible:outline-2"
        >
          {ticket.key}
        </Link>
      </TableCell>
      <TableCell className="text-foreground">
        <Link href={href} className="hover:underline">
          {ticket.title}
        </Link>
        {ticket.commentCount > 0 && (
          <span
            className="text-caption text-muted-foreground ml-2 inline-flex items-center gap-0.5 align-middle"
            aria-label={`${ticket.commentCount} ${ticket.commentCount === 1 ? "comentario" : "comentarios"}`}
          >
            <MessageSquareIcon aria-hidden="true" className="size-3" />
            {ticket.commentCount}
          </span>
        )}
      </TableCell>
      <TableCell>
        <TicketStatusBadge status={ticket.status} />
      </TableCell>
      <TableCell>
        <TicketPriorityBadge priority={ticket.priority} />
      </TableCell>
      <TableCell className="text-secondary-foreground">
        {ticket.assigneeName ?? (
          <span className="text-muted-foreground">Sin asignar</span>
        )}
      </TableCell>
      {sprintControls ? (
        <TicketRowSprintControls
          ticket={ticket}
          openSprints={sprintControls.openSprints}
        />
      ) : (
        <>
          <TableCell className="text-secondary-foreground">
            {ticket.sprintName || ticket.sprintNumero ? (
              formatSprintDisplayName({
                numero: ticket.sprintNumero!,
                name: ticket.sprintName,
              })
            ) : (
              <span className="text-muted-foreground">Backlog</span>
            )}
          </TableCell>
          <TableCell className="font-data text-right">
            {ticket.estimatedHours !== null ? (
              ticket.estimatedHours
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
        </>
      )}
      <TableCell
        className="font-data text-right text-muted-foreground"
        title={formatAbsoluteFull(ticket.updatedAt)}
      >
        {formatRelativeShort(ticket.updatedAt)}
      </TableCell>
    </TableRow>
  );
}
