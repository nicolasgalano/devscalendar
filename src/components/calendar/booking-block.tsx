"use client";

import { FlagIcon } from "lucide-react";

import { BookingStatusTag, bookingStatusLabel } from "@/components/calendar/booking-status";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatTimeRange } from "@/lib/calendar/format";
import type { GridRows } from "@/lib/calendar/layout";
import { categoryClasses } from "@/lib/calendar/palette";
import type { CalendarBooking } from "@/lib/calendar/query";
import { cn } from "@/lib/utils";

export type BookingBlockProps = {
  booking: CalendarBooking;
  rows: GridRows;
  column: number;
  columns: number;
  /** Which entity drives the categorical hue — follows the grouping axis. */
  colorKey: string;
  tz: string;
};

/**
 * A booking on the day grid.
 *
 * DESIGN.md §2, condition 3: the categorical colour is never the only
 * identifier — the block always spells out developer and project. §12: it is a
 * focusable element whose accessible name carries everything the colour and
 * position convey.
 *
 * The read-only detail popover exists to resolve the tension between §12
 * (blocks must be focusable) and §7 (nothing focusable that leads nowhere):
 * there is no booking detail view until 004, so focus opens the detail right
 * here. 004 swaps the popover for the edit panel without touching the grid.
 */
export function BookingBlock({
  booking,
  rows,
  column,
  columns,
  colorKey,
  tz,
}: BookingBlockProps) {
  const time = formatTimeRange(booking.startsAt, booking.endsAt, tz);
  const isHighPriority = booking.project.priority === "high";
  const isCancelled = booking.status === "cancelled";
  // §8: rechazada y desplazada son las dos que obligan al PM a reasignar.
  const needsAttention = booking.status === "rejected" || booking.status === "displaced";

  const accessibleName = [
    booking.dev.name,
    booking.project.name,
    booking.project.client.name,
    time,
    bookingStatusLabel(booking.status),
    isHighPriority ? "proyecto prioritario" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Popover>
      <PopoverTrigger
        aria-label={accessibleName}
        className={cn(
          "absolute overflow-hidden rounded-md border-l-2 px-1.5 py-1 text-left outline-none",
          "cursor-pointer transition-[box-shadow,opacity]",
          "hover:ring-1 hover:ring-foreground/15",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          categoryClasses(colorKey),
          // DESIGN.md §2, condition 2: attention signals have to read *above*
          // the categorical hue. The left rule switches from the project's
          // colour to --attention, so a displaced or rejected booking is
          // distinguishable at a glance from one that is still live — without
          // that, a displaced block looks exactly like a double booking.
          needsAttention && "border-l-attention",
          // §8: a cancelled booking dims its title instead of disappearing.
          isCancelled && "opacity-60",
        )}
        // Absolutely positioned *inside its grid area*: a grid child with an
        // explicit `grid-row` uses that area as its containing block, so the
        // block gets the exact height of its time span while `left`/`width`
        // split it against the overlapping ones (AC-2.2). Inline styles because
        // the split depends on the data, not on a breakpoint.
        style={{
          gridRow: `${rows.rowStart} / ${rows.rowEnd}`,
          left: `calc(${(column / columns) * 100}% + 2px)`,
          width: `calc(${100 / columns}% - 4px)`,
          top: 0,
          bottom: 0,
        }}
      >
        {/*
          Dos columnas, no cuatro líneas: desarrollador y proyecto apilados a la
          izquierda, cliente a la derecha. Una reserva de una hora mide 48px —
          dos líneas — así que una cuarta línea quedaría recortada.

          El horario no se muestra: la posición y la altura del bloque ya lo
          dicen. Sigue en el popover y en el nombre accesible, que es lo que
          necesita quien no ve la grilla.
        */}
        {/*
          Flex, no grid: con `grid-cols-[1fr_auto]` el `max-width` porcentual
          del cliente se resolvía contra una columna `auto` cuyo tamaño depende
          del propio contenido, y el navegador la colapsaba a 25px — o sea, a
          los puntos suspensivos. En flex el porcentaje se mide contra el ancho
          del contenedor, que sí es definido.

          El cliente lleva `shrink-0`: toma el ancho de su texto y no cede,
          topeado a la mitad del bloque para que nunca se coma el nombre del
          desarrollador. Lo que se recorta primero es la columna izquierda.
        */}
        <span className="flex h-full items-start gap-x-2">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              {/* AC-2.3: priority reads as an icon too, never as colour alone. */}
              {isHighPriority && (
                <FlagIcon aria-hidden="true" className="size-3 shrink-0 text-priority-high" />
              )}
              <span
                className={cn(
                  "truncate text-caption font-medium",
                  isCancelled ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {booking.dev.name}
              </span>
            </span>
            <span className="flex items-center gap-1">
              {/* Functional spec §4.2: the block shows the state. Without it a
                  displaced booking is indistinguishable from a live one and the
                  grid reads as a double booking. The label lives in the
                  accessible name, since there is no room for it here. */}
              <BookingStatusTag
                status={booking.status}
                iconOnly
                className="shrink-0 [&_svg]:size-3"
              />
              <span className="truncate text-caption text-secondary-foreground">
                {booking.project.name}
              </span>
            </span>
          </span>

          <span className="max-w-1/2 shrink-0 truncate text-caption text-muted-foreground">
            {booking.project.client.name}
          </span>
        </span>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80">
        <PopoverHeader>
          <PopoverTitle className="text-emphasis">{booking.project.name}</PopoverTitle>
          <PopoverDescription>{booking.project.client.name}</PopoverDescription>
        </PopoverHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ui">
          <dt className="text-muted-foreground">Desarrollador</dt>
          <dd>{booking.dev.name}</dd>

          <dt className="text-muted-foreground">Horario</dt>
          <dd className="font-data">{time}</dd>

          <dt className="text-muted-foreground">Estado</dt>
          <dd>
            <BookingStatusTag status={booking.status} />
          </dd>

          <dt className="text-muted-foreground">Prioridad</dt>
          <dd>{isHighPriority ? "Prioritario" : "Común"}</dd>

          {booking.ticketRef && (
            <>
              <dt className="text-muted-foreground">Ticket</dt>
              <dd className="font-data">{booking.ticketRef}</dd>
            </>
          )}
        </dl>

        {booking.note && (
          <p className="border-t border-border pt-2 text-ui text-secondary-foreground">
            {booking.note}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
