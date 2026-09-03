import type { ProjectPriority } from "@/lib/validation/calendar";

/**
 * Why a slot cannot be taken from whoever holds it.
 *
 * The two refusals are separate values and not one message with different
 * wording, because the PM does something different with each: `insufficient`
 * means look for another slot, `tie` means pick up the phone. `plan.md` §4 asks
 * for both 409s to be distinguishable all the way to the UI, and a single
 * reason with a formatted string would have collapsed them again on the way.
 */
export type DisplaceRefusal = "insufficient" | "tie";

/**
 * The matrix of `plan.md` §5, and nothing else.
 *
 * | new      | existing | result                       |
 * | :------- | :------- | :--------------------------- |
 * | high     | normal   | displaces                    |
 * | normal   | high     | blocked (AC-1.2)             |
 * | normal   | normal   | blocked, ordinary conflict   |
 * | high     | high     | blocked, by the PMs (AC-1.3) |
 *
 * Only `approved` bookings are ever passed in here. Two `pending` bookings on
 * the same slot coexist by design (`004` AC-4.2) — the exclusion constraint
 * does not look at them, so a booking nobody approved yet occupies nothing and
 * there is nothing to displace.
 *
 * The database enforces the same rule inside `reallocate_booking()`. This copy
 * exists so the UI can decide what to offer before anyone writes, and so the
 * handler can answer 409 instead of turning a raised exception into a 500 —
 * same division of labour as `nextStatusAfterResponse` and its trigger.
 */
export function canDisplace(
  newPriority: ProjectPriority,
  existingPriority: ProjectPriority,
): boolean {
  return newPriority === "high" && existingPriority === "normal";
}

/**
 * Why `canDisplace` said no, or `null` when it said yes.
 *
 * A tie is only a tie between two priority projects. A common project facing a
 * priority one is not "tied", it is outranked — and telling that PM to go
 * negotiate would send them to a conversation they have no standing in.
 */
export function explainDisplaceRefusal(
  newPriority: ProjectPriority,
  existingPriority: ProjectPriority,
): DisplaceRefusal | null {
  if (canDisplace(newPriority, existingPriority)) return null;
  if (newPriority === "high" && existingPriority === "high") return "tie";
  return "insufficient";
}

/** Copy for a refusal, with the project that holds the slot named. */
export function describeDisplaceRefusal(
  refusal: DisplaceRefusal,
  { projectName, pmName }: { projectName: string; pmName?: string | null },
): string {
  if (refusal === "tie") {
    return `La franja está ocupada por ${projectName}, que también es prioritario. Resolvelo con ${
      pmName ?? "su PM"
    }.`;
  }

  return `La franja está ocupada por ${projectName}, y este proyecto no es prioritario.`;
}

/**
 * Lo que hace falta de una reserva para ordenarla o cruzarla con otra. Es un
 * subconjunto estructural de `CalendarBooking`, así que cualquiera de esas
 * entra sin adaptarla.
 */
type PendingSlot = {
  id: string;
  startsAt: string;
  endsAt: string;
  project: { priority: ProjectPriority };
};

/**
 * Orden de la bandeja del dev: **lo prioritario primero, después por fecha.**
 *
 * Es la mitigación (a) de R-2, decidida el 2026-09-03. La regla de prioridad
 * solo juega al *crear*, no al *aprobar*: dos reservas pendientes sobre la
 * misma franja conviven —el exclusion constraint no mira las pendientes— así
 * que si el dev aprueba primero la común, la prioritaria ya no puede aprobarse
 * y el proyecto prioritario pierde la franja sin que nadie haya desplazado
 * nada.
 *
 * Esto **no cierra ese agujero**, lo hace visible. El dev sigue pudiendo
 * aprobar la común; lo que cambia es que deja de ser un accidente del orden de
 * la lista. Cerrarlo de verdad es la opción (b) —desplazar también al
 * aprobar— y quedó como deuda en `006/tasks.md` F4.
 */
export function comparePendingBookings(a: PendingSlot, b: PendingSlot): number {
  if (a.project.priority !== b.project.priority) {
    return a.project.priority === "high" ? -1 : 1;
  }
  return Date.parse(a.startsAt) - Date.parse(b.startsAt);
}

/**
 * Las reservas comunes que se superponen con una prioritaria **todavía
 * pendiente**: aprobar una de estas es lo que le cuesta la franja al proyecto
 * prioritario.
 *
 * Ordenar la lista sin decir por qué sería un badge decorativo. Esto es lo que
 * convierte el orden en una advertencia: nombra las reservas concretas donde
 * la decisión tiene consecuencia, en vez de avisar en abstracto en todas.
 *
 * El solape usa la misma comparación semiabierta que el constraint y que
 * `reallocate_booking()`: `[)`, así que 09:00–13:00 y 13:00–17:00 no chocan.
 */
export function outrankedByPending(bookings: PendingSlot[]): Set<string> {
  const priority = bookings.filter((booking) => booking.project.priority === "high");

  return new Set(
    bookings
      .filter(
        (booking) =>
          booking.project.priority !== "high" &&
          priority.some(
            (other) =>
              Date.parse(booking.startsAt) < Date.parse(other.endsAt) &&
              Date.parse(booking.endsAt) > Date.parse(other.startsAt),
          ),
      )
      .map((booking) => booking.id),
  );
}

/**
 * SQLSTATEs `reallocate_booking()` raises. See the header of
 * `00000000000008_reallocation.sql` for the full table.
 *
 * They are custom codes, so PostgREST does not know what HTTP status to give
 * them and may answer 500. The handler translates by code, from the JSON body,
 * never by the status the response arrived with.
 */
export const REALLOCATION_ERRORS = {
  /** The caller does not manage the project the new booking is for. */
  notManager: "42501",
  /** The new project is not a priority one. */
  insufficient: "DC001",
  /** Both projects are priority: the PMs settle it (AC-1.3). */
  tie: "DC002",
  /** What holds the slot now is not what the PM confirmed displacing. */
  stale: "DC003",
  /** Project or developer invalid or inactive. */
  invalidTarget: "DC004",
} as const;
