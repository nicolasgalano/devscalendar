import Link from "next/link";

import { TicketPriorityBadge } from "@/components/tickets/ticket-priority";
import { TicketStatusBadge } from "@/components/tickets/ticket-status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAbsoluteFull, formatRelativeShort } from "@/lib/tickets/relative-time";
import type { TicketListItem } from "@/lib/tickets/query";

/**
 * DESIGN.md §7: la fila es la unidad de navegación. Cada fila es un `<Link>`
 * sobre la clave, y el resto de las celdas heredan el mismo href para que
 * clickear en cualquier parte de la fila abra el detalle. La `Key` va en
 * `.font-data` con `--primary` (§4, es link) — es el identificador estable
 * que el usuario aprende a leer.
 */
export function TicketList({ tickets }: { tickets: TicketListItem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">Clave</TableHead>
          <TableHead>Título</TableHead>
          <TableHead className="w-36">Estado</TableHead>
          <TableHead className="w-28">Prioridad</TableHead>
          <TableHead className="w-40">Asignado</TableHead>
          <TableHead className="w-32 text-right">Actualizado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.map((ticket) => (
          <TicketRow key={ticket.id} ticket={ticket} />
        ))}
      </TableBody>
    </Table>
  );
}

function TicketRow({ ticket }: { ticket: TicketListItem }) {
  const href = `/tickets/${ticket.key}`;
  return (
    <TableRow className="hover:bg-surface-hover cursor-pointer">
      <TableCell className="font-data text-primary">
        <Link href={href} className="focus-visible:outline-ring rounded-sm outline-none focus-visible:outline-2">
          {ticket.key}
        </Link>
      </TableCell>
      <TableCell className="text-foreground">
        <Link href={href} className="hover:underline">
          {ticket.title}
        </Link>
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
      <TableCell
        className="font-data text-right text-muted-foreground"
        title={formatAbsoluteFull(ticket.updatedAt)}
      >
        {formatRelativeShort(ticket.updatedAt)}
      </TableCell>
    </TableRow>
  );
}
