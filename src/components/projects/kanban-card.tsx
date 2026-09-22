"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MessageSquareIcon } from "lucide-react";

import { TicketPriorityBadge } from "@/components/tickets/ticket-priority";
import type { TicketListItem } from "@/lib/tickets/query";
import { cn } from "@/lib/utils";

/**
 * Tarjeta del tablero (feature 017 T3.2). Muestra `KEY`, título, prioridad y
 * asignado. La tarjeta es a la vez:
 *   - Un `<Link>` al detalle, cuando no está siendo arrastrada.
 *   - Un handle de dnd-kit, cuando `draggable` es `true`.
 *
 * `useSortable` con `disabled: !draggable` deja que las cards que el usuario
 * no puede mover queden estáticas — el sensor de puntero las salta y las de
 * teclado también. La verdad la impone el trigger `enforce_ticket_contributor_scope`
 * en la base; esto es UX.
 *
 * El `activationConstraint: { distance: 6 }` del `PointerSensor` en el board
 * asegura que un click "rápido" navega al detalle sin activar el drag —
 * necesario porque el `<Link>` está adentro del handle.
 */
export function KanbanCard({
  ticket,
  draggable,
  isOverlay = false,
}: {
  ticket: TicketListItem;
  draggable: boolean;
  /** El overlay del `DragOverlay` — sin listeners, solo el visual flotante. */
  isOverlay?: boolean;
}) {
  const sortable = useSortable({
    id: ticket.id,
    disabled: !draggable,
    data: { status: ticket.status },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={isOverlay ? undefined : sortable.setNodeRef}
      style={isOverlay ? undefined : style}
      {...(isOverlay ? {} : sortable.attributes)}
      {...(isOverlay ? {} : sortable.listeners)}
      aria-roledescription={draggable ? "Tarjeta arrastrable" : undefined}
      aria-disabled={!draggable || undefined}
      className={cn(
        "border-border bg-background flex flex-col gap-1.5 rounded-md border p-2.5",
        "focus-visible:outline-ring outline-none focus-visible:outline-2",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        // Mientras se arrastra, la tarjeta original queda opaca; el DragOverlay
        // muestra la que "flota". Sin esto habría dos tarjetas visibles.
        sortable.isDragging && !isOverlay && "opacity-30",
        isOverlay && "shadow-lg ring-1 ring-foreground/10",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/tickets/${ticket.key}`}
          className="font-data text-caption text-primary hover:underline"
          // Al arrastrar, evitamos que el click del "drop" navegue. dnd-kit
          // no dispara el evento de click cuando cumple el activation
          // constraint, pero un mousedown-y-arrastrar todavía puede
          // interferir con navegación por teclado — draggable="false" en el
          // link evita que el browser inicie su propio drag "de link".
          draggable={false}
        >
          {ticket.key}
        </Link>
        <TicketPriorityBadge priority={ticket.priority} />
      </div>
      <p className="text-ui text-foreground line-clamp-2">{ticket.title}</p>
      <div className="text-caption text-muted-foreground flex items-center justify-between gap-2">
        <span className="truncate">{ticket.assigneeName ?? "Sin asignar"}</span>
        {ticket.commentCount > 0 && (
          <span
            className="inline-flex items-center gap-0.5"
            aria-label={`${ticket.commentCount} ${ticket.commentCount === 1 ? "comentario" : "comentarios"}`}
          >
            <MessageSquareIcon aria-hidden="true" className="size-3" />
            {ticket.commentCount}
          </span>
        )}
      </div>
    </div>
  );
}
