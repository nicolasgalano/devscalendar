"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { TICKET_STATUS_LABELS } from "@/lib/tickets/status";
import type { TicketListItem } from "@/lib/tickets/query";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

import { KanbanCard } from "./kanban-card";

type TicketStatus = Database["public"]["Enums"]["ticket_status"];

/**
 * Columna del tablero (feature 017 T3.3). Ancho fijo 240px, header con label
 * del estado + contador, cuerpo scrolleable con las tarjetas.
 *
 * `useDroppable` con `data: { status }` es lo que el `handleDragEnd` del
 * board consulta para saber a qué estado se soltó la tarjeta. Sin esta data,
 * habría que codear el mapeo columna → estado en otro lugar.
 *
 * `SortableContext` con `verticalListSortingStrategy` permite reordenar
 * dentro de la columna. En este MVP no persistimos ese orden (F1 del `tasks.md`),
 * pero el strategy hace que las tarjetas se abran para dejar lugar mientras se
 * arrastra — es puramente visual y correcto de conservar.
 */
export function KanbanColumn({
  status,
  tickets,
  canDrag,
}: {
  status: TicketStatus;
  tickets: TicketListItem[];
  /** Función que decide, por tarjeta, si el usuario puede arrastrarla. */
  canDrag: (ticket: TicketListItem) => boolean;
}) {
  const droppable = useDroppable({ id: `column-${status}`, data: { status } });

  return (
    <div className="flex w-60 shrink-0 flex-col gap-2">
      <div className="text-caption text-muted-foreground flex items-center justify-between px-1 font-medium">
        <span>{TICKET_STATUS_LABELS[status]}</span>
        <span className="font-data">{tickets.length}</span>
      </div>
      <div
        ref={droppable.setNodeRef}
        className={cn(
          "bg-surface flex-1 rounded-md p-1.5",
          "flex max-h-[calc(100vh-16rem)] min-h-96 flex-col gap-1.5 overflow-y-auto",
          droppable.isOver && "ring-primary ring-2 ring-inset",
        )}
      >
        <SortableContext items={tickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tickets.length === 0 ? (
            <p className="text-caption text-muted-foreground px-2 py-4 italic">
              Sin tickets en {TICKET_STATUS_LABELS[status].toLowerCase()}
            </p>
          ) : (
            tickets.map((ticket) => (
              <KanbanCard key={ticket.id} ticket={ticket} draggable={canDrag(ticket)} />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}
