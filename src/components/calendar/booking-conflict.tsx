import type { ReactNode } from "react";
import Link from "next/link";
import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react";

import type { BookingConflict } from "@/lib/bookings/conflicts";
import { formatTimeRange } from "@/lib/calendar/format";
import { instantToIsoDate } from "@/lib/calendar/range";
import { calendarHref } from "@/lib/calendar/url";
import type { CalendarParams } from "@/lib/validation/calendar";

/**
 * DESIGN.md §8, el estado de conflicto: icono `alert-triangle`, texto en
 * `--danger` y **el motivo siempre en palabras**. El color no porta ninguna
 * información que no esté también escrita.
 *
 * El link no es decorativo: sin él, "hay una reserva que bloquea" obliga a
 * salir a buscarla por el calendario a mano.
 *
 * Nació dentro de `booking-dialog` en `004` y `005` lo sacó acá al necesitarlo
 * en la bandeja. El título es parametrizable porque **el conflicto se le cuenta
 * distinto a cada uno**: al PM, "Malena ya tiene una reserva aprobada en esa
 * franja"; al desarrollador que está aprobando la suya, "Ya tenés aprobada otra
 * reserva en esa franja". Es la misma fila de la base y son dos frases
 * distintas, y la segunda en tercera persona sonaría a que el problema es de
 * otro.
 */
export function ConflictNotice({
  conflict,
  title,
  tone = "blocking",
  action,
  params,
  tz,
}: {
  conflict: BookingConflict;
  title?: string;
  /**
   * `006` T4.1. **El conflicto que se puede desplazar no se pinta como el que
   * impide seguir** (§8): `circle-alert` sobre `--attention` en vez de
   * `alert-triangle` sobre `--danger`, porque acá hay un camino hacia adelante
   * y el rojo enseñaría a ignorar el rojo. Lo mismo que separa la advertencia
   * de jornada del conflicto, aplicado un escalón más arriba.
   */
  tone?: "blocking" | "displaceable";
  /** La salida, cuando la hay: el botón que ofrece desplazar. */
  action?: ReactNode;
  params: CalendarParams;
  tz: string;
}) {
  const date = instantToIsoDate(conflict.startsAt, tz);
  const displaceable = tone === "displaceable";
  const Icon = displaceable ? CircleAlertIcon : TriangleAlertIcon;

  return (
    <div
      role="alert"
      data-slot="booking-conflict"
      data-tone={tone}
      className={
        displaceable
          ? "bg-attention-bg text-ui text-attention flex gap-2 rounded-lg p-2.5"
          : "bg-danger-bg text-ui text-danger flex gap-2 rounded-lg p-2.5"
      }
    >
      <Icon aria-hidden="true" className="mt-px size-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">
          {title ?? `${conflict.devName} ya tiene una reserva aprobada en esa franja`}
        </p>
        <p>
          {conflict.projectName},{" "}
          <span className="font-data">
            {formatTimeRange(conflict.startsAt, conflict.endsAt, tz)}
          </span>
        </p>
        <Link
          href={calendarHref(params, { view: "day", date })}
          className="w-fit underline underline-offset-3 hover:no-underline"
        >
          Ver ese día en el calendario
        </Link>
        {action}
      </div>
    </div>
  );
}
