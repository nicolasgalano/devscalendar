"use client";

import { useState, type MouseEvent } from "react";
import { PlusIcon } from "lucide-react";

import { useBookingActions, type CreatePrefill } from "@/components/calendar/booking-actions";
import { formatMinuteOfDay } from "@/lib/calendar/format";
import { MINUTES_PER_ROW, type DayWindow } from "@/lib/calendar/range";
import { WORKDAY_START_HOUR } from "@/lib/calendar/workdays";

/**
 * Capa clickeable sobre el fondo de un carril: abre el alta con el
 * desarrollador (o el proyecto) del carril y la franja donde se hizo click.
 *
 * **Un solo elemento enfocable por carril, no uno por franja.** Con franjas de
 * 30 minutos, una jornada da 16 botones por carril y una vista de ocho
 * desarrolladores daría 128 paradas de tabulación antes de llegar a la primera
 * reserva: la vista quedaría inoperable con teclado, que es justo lo que
 * DESIGN.md §12 pide evitar. Acá el puntero elige la franja por su posición y el
 * teclado entra por el inicio de la jornada; para cualquier otro horario está el
 * formulario, que es igual de accesible.
 *
 * Los bloques se dibujan después en el DOM, así que quedan por encima: hacer
 * click en una reserva abre su detalle, no el alta.
 */
export function DayGridSlots({
  lane,
  isoDate,
  window,
  rowHeight,
  laneName,
}: {
  /** Qué precarga el carril, según el eje de agrupación activo. */
  lane: { axis: "dev" | "project"; id: string };
  isoDate: string;
  window: DayWindow;
  rowHeight: number;
  laneName: string;
}) {
  const { hasBookableOptions, createBooking } = useBookingActions();
  const [hoverMinute, setHoverMinute] = useState<number | null>(null);

  if (!hasBookableOptions) return null;

  const lastMinute = window.endMinute - MINUTES_PER_ROW;

  function minuteAt(event: MouseEvent<HTMLButtonElement>): number {
    const bounds = event.currentTarget.getBoundingClientRect();
    const row = Math.floor((event.clientY - bounds.top) / rowHeight);
    const minute = window.startMinute + row * MINUTES_PER_ROW;
    return Math.min(Math.max(minute, window.startMinute), lastMinute);
  }

  const prefill = (startMinute: number): CreatePrefill => ({
    date: isoDate,
    startMinute,
    ...(lane.axis === "dev" ? { devId: lane.id } : { projectId: lane.id }),
  });

  return (
    <button
      type="button"
      // Un click de teclado no trae posición (`detail === 0`): en ese caso la
      // reserva arranca al inicio de la jornada, o al inicio de la ventana
      // visible si el día ya empieza antes.
      onClick={(event) =>
        createBooking(
          prefill(
            event.detail === 0
              ? Math.max(window.startMinute, Math.min(WORKDAY_START_HOUR * 60, lastMinute))
              : minuteAt(event),
          ),
        )
      }
      onMouseMove={(event) => {
        const next = minuteAt(event);
        setHoverMinute((current) => (current === next ? current : next));
      }}
      onMouseLeave={() => setHoverMinute(null)}
      aria-label={`Crear reserva en ${laneName}`}
      data-lane-slots={lane.id}
      className="absolute inset-0 cursor-pointer outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      {hoverMinute !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 flex items-center gap-1 bg-surface-hover px-1.5 text-caption text-muted-foreground"
          style={{
            top: ((hoverMinute - window.startMinute) / MINUTES_PER_ROW) * rowHeight,
            height: rowHeight,
          }}
        >
          <PlusIcon className="size-3 shrink-0" />
          <span className="font-data">{formatMinuteOfDay(hoverMinute)}</span>
        </span>
      )}
    </button>
  );
}
