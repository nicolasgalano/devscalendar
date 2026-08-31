"use client";

import Link from "next/link";
import { CircleAlertIcon, FlagIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import {
  BookingResponseActions,
  BookingResponseProvider,
} from "@/components/calendar/booking-response";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fromBooking } from "@/lib/bookings/form";
import { describeBookingWarnings } from "@/lib/bookings/warnings";
import { capitalize, formatLongDate, formatTimeRange } from "@/lib/calendar/format";
import type { CalendarBooking } from "@/lib/calendar/query";
import { instantToIsoDate } from "@/lib/calendar/range";
import { calendarHref } from "@/lib/calendar/url";
import type { CalendarParams } from "@/lib/validation/calendar";

/**
 * AC-1.1 — la bandeja del desarrollador.
 *
 * **Los cuatro estados de datos de DESIGN.md §9, y la excepción anotada:**
 * cargando vive en `loading.tsx`, el error en el boundary de la ruta, y el
 * vacío está acá abajo. "Sin resultados de filtro" **no se implementa porque no
 * puede ocurrir**: la bandeja no es filtrable, muestra todo lo pendiente de una
 * persona. Fingir ese estado sería inventar un control que no existe.
 */
export function InboxList({
  bookings,
  params,
  tz,
}: {
  bookings: CalendarBooking[];
  params: CalendarParams;
  tz: string;
}) {
  if (bookings.length === 0) {
    return (
      <EmptyState
        title="Sin reservas para responder"
        // §9 pide un botón con verbo. Acá el vacío es buena noticia, no una
        // carencia, y el dev no tiene ningún verbo que ejercer sobre una lista
        // vacía: el link al calendario es el único destino honesto.
        description="Cuando un PM te reserve tiempo, la reserva aparece acá para que la apruebes o la rechaces."
        action={
          <Link href={calendarHref(params)} className={buttonVariants({ variant: "outline" })}>
            Ver el calendario
          </Link>
        }
      />
    );
  }

  return (
    <BookingResponseProvider params={params} tz={tz}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Proyecto</TableHead>
            <TableHead>Día</TableHead>
            <TableHead>Horario</TableHead>
            <TableHead>Nota</TableHead>
            <TableHead className="text-right">Respuesta</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bookings.map((booking) => (
            <InboxRow key={booking.id} booking={booking} tz={tz} />
          ))}
        </TableBody>
      </Table>
    </BookingResponseProvider>
  );
}

function InboxRow({ booking, tz }: { booking: CalendarBooking; tz: string }) {
  const date = instantToIsoDate(booking.startsAt, tz);
  const isHighPriority = booking.project.priority === "high";

  return (
    <TableRow>
      <TableCell>
        <span className="flex items-center gap-1.5">
          {/* AC-2.3 y §8: la prioridad se lee también como icono, nunca solo
              como color. */}
          {isHighPriority && (
            <FlagIcon
              aria-label="Proyecto prioritario"
              className="text-priority-high size-3.5 shrink-0"
            />
          )}
          <span className="min-w-0">
            <span className="text-emphasis block truncate font-medium">{booking.project.name}</span>
            <span className="text-caption text-muted-foreground block truncate">
              {booking.project.client.name}
            </span>
          </span>
        </span>
      </TableCell>

      {/* §4: fechas y horarios en numeración tabular. */}
      <TableCell className="font-data whitespace-nowrap">
        {capitalize(formatLongDate(date, tz))}
      </TableCell>

      <TableCell className="font-data whitespace-nowrap">
        <span className="flex items-center gap-1.5">
          {formatTimeRange(booking.startsAt, booking.endsAt, tz)}
          <BookingWarnings booking={booking} tz={tz} />
        </span>
      </TableCell>

      <TableCell className="max-w-xs">
        {booking.note ? (
          <span className="block truncate" title={booking.note}>
            {booking.note}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell>
        <div className="flex justify-end">
          <BookingResponseActions booking={booking} />
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Q-G: reservar fuera de la jornada o en un día no laborable es excepcional
 * pero está permitido. Al dev le conviene enterarse **antes** de aprobar.
 *
 * Reusa `describeBookingWarnings()` en vez de recalcular las reglas: es la
 * misma advertencia que ve el PM al crear la reserva, palabra por palabra, y
 * además ya sabe qué contestar cuando la fecha cae fuera de la tabla de
 * feriados cargada — cosa que en la bandeja pasa más que en el diálogo, porque
 * acá no hay recorte por rango y una pendiente puede ser de dentro de un año.
 *
 * §8: advertir y bloquear no comparten tratamiento. Esto es `circle-alert`
 * sobre `--attention` y no toca los botones; lo que impide seguir es el
 * conflicto, que usa `alert-triangle` sobre `--danger`.
 */
function BookingWarnings({ booking, tz }: { booking: CalendarBooking; tz: string }) {
  const warnings = describeBookingWarnings(fromBooking(booking, tz));
  if (warnings.length === 0) return null;

  return (
    <span className="text-attention inline-flex items-center gap-1" data-slot="booking-warning">
      <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
      {/* El motivo siempre en palabras, nunca solo el color (checklist 12). El
          texto completo va al `title` para no romper la fila de 36px. */}
      <span className="sr-only">{warnings.map((warning) => warning.message).join(" ")}</span>
      <span
        aria-hidden="true"
        className="text-caption"
        title={warnings.map((w) => w.message).join(" ")}
      >
        {warnings.length === 1 && warnings[0]!.id === "outside-hours"
          ? "Fuera de horario"
          : "Revisar"}
      </span>
    </span>
  );
}
