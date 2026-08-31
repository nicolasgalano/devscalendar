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
export function nextStatusAfterEdit(current: BookingSnapshot, edit: BookingEdit): BookingStatus {
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

/**
 * The two answers the developer can give. Cancelling and displacing move a
 * booking too, but the first belongs to the PM and the second to the
 * reallocation of `006`.
 */
export type BookingResponse = Extract<BookingStatus, "approved" | "rejected">;

/**
 * `plan.md` §3.3: only a booking that is still `pending` is answered.
 *
 * `approved -> rejected` would be the developer taking back a commitment the PM
 * already planned around, and `rejected -> approved` contradicts the functional
 * spec §5.2, where a rejection becomes a *new* booking instead of a pending one
 * again. Both are a conversation with the PM, not a button (F3).
 */
export function canRespond(status: BookingStatus): boolean {
  return status === "pending";
}

/**
 * The status a booking lands on once the developer answers, or `null` when the
 * answer does not apply to it.
 *
 * Sibling of `nextStatusAfterEdit`, and it exists for the same reason: the rule
 * about which transitions are legal lives in one pure function a unit test can
 * exhaust, instead of spread across a handler. The database enforces the same
 * rule inside `enforce_booking_status_transition()` — this is the copy that can
 * answer with a 409 instead of letting a raised exception become a 500.
 */
export function nextStatusAfterResponse(
  current: BookingStatus,
  response: BookingResponse,
): BookingStatus | null {
  return canRespond(current) ? response : null;
}

/**
 * Postgres `check_violation` — the errcode `enforce_booking_status_transition()`
 * raises, both for the column guard of `005` and for the "approving is not the
 * PM's call" rule of `004`. It means the caller asked for something the database
 * refuses on principle, so it translates to 403 and never to 500.
 */
export const TRANSITION_VIOLATION = "23514";

/** Human reason for refusing an edit, a cancellation or a response. */
export function explainBlockedAction(
  action: "edit" | "cancel" | "respond",
  status: BookingStatus,
): string {
  const labels: Record<BookingStatus, string> = {
    pending: "pendiente",
    approved: "aprobada",
    rejected: "rechazada",
    cancelled: "cancelada",
    displaced: "desplazada",
  };

  const verbs = { edit: "editar", cancel: "cancelar", respond: "responder" } as const;

  return `Una reserva ${labels[status]} no se puede ${verbs[action]}`;
}
