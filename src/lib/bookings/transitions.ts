import type { BookingStatus } from "@/lib/validation/calendar";

/** The part of a booking the transition rules look at. */
export type BookingSnapshot = {
  status: BookingStatus;
  devId: string;
  startsAt: string;
  endsAt: string;
};

/** Fields a PM may edit. Anything absent is left untouched. */
export type BookingEdit = {
  devId?: string;
  startsAt?: string;
  endsAt?: string;
  note?: string | null;
  ticketRef?: string | null;
};

/**
 * Whether the edit changes *what the developer agreed to*: who works, or when.
 * Notes and tickets are context around the commitment, not the commitment.
 */
export function isReschedule(current: BookingSnapshot, edit: BookingEdit): boolean {
  const changed = (next: string | undefined, now: string) =>
    next !== undefined && Date.parse(next) !== Date.parse(now);

  return (
    (edit.devId !== undefined && edit.devId !== current.devId) ||
    changed(edit.startsAt, current.startsAt) ||
    changed(edit.endsAt, current.endsAt)
  );
}

/**
 * Q-E, answered by the client on 2026-08-06: moving the slot or swapping the
 * developer on an approved booking sends it back to `pending`; editing the note
 * or the ticket leaves the approval alone.
 *
 * The rule only applies to `approved`. A `pending` booking edited stays
 * pending — there is no approval to invalidate.
 */
export function nextStatusAfterEdit(
  current: BookingSnapshot,
  edit: BookingEdit,
): BookingStatus {
  if (current.status === "approved" && isReschedule(current, edit)) return "pending";
  return current.status;
}

/**
 * AC-3.1: cancelling is available from any state except the two that are
 * already terminal in the other direction. Cancelling a cancelled booking is a
 * no-op dressed as an action, and a displaced one was already superseded by a
 * higher-priority reallocation (functional spec §7).
 */
export function canCancel(status: BookingStatus): boolean {
  return status !== "cancelled" && status !== "displaced";
}

/**
 * Editing only makes sense while the booking is still live. A rejected booking
 * is not edited: the PM reassigns, which is a new booking (functional spec §5.2
 * — `rejected` transitions to "nueva reserva", not back to pending).
 */
export function canEdit(status: BookingStatus): boolean {
  return status === "pending" || status === "approved";
}

/** Human reason for refusing an edit or a cancellation, for the API response. */
export function explainBlockedAction(
  action: "edit" | "cancel",
  status: BookingStatus,
): string {
  const labels: Record<BookingStatus, string> = {
    pending: "pendiente",
    approved: "aprobada",
    rejected: "rechazada",
    cancelled: "cancelada",
    displaced: "desplazada",
  };

  return action === "cancel"
    ? `Una reserva ${labels[status]} no se puede cancelar`
    : `Una reserva ${labels[status]} no se puede editar`;
}
