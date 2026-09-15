import { TICKET_STATUS_LABELS } from "@/lib/tickets/status";
import type { Database } from "@/types/database";

/**
 * Los ocho tipos de aviso, como unión y no leídos de `Database`.
 *
 * `notifications.type` es un `check` y no un enum de Postgres —misma decisión
 * que `bookings.status` en 004— así que el generador de tipos lo da como
 * `string`. Escribirlos acá es lo que hace que agregar un tipo nuevo rompa el
 * `Record` de abajo en vez de dejar un aviso sin texto.
 *
 * Los dos de tickets se agregan en `015`. La tabla `notifications` ya los
 * acepta (migration 14 re-creó el check constraint).
 */
export const NOTIFICATION_TYPES = [
  "booking_created",
  "booking_approved",
  "booking_rejected",
  "booking_cancelled",
  "booking_needs_reapproval",
  "booking_displaced",
  "ticket_assigned",
  "ticket_status_changed",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

type TicketStatus = Database["public"]["Enums"]["ticket_status"];

/**
 * Lo que una notificación necesita saber para poder mostrarse **sin volver a la
 * base**. Se congela al escribir la fila, en el trigger: un aviso tiene que
 * poder decir "te sacaron el martes en Proyecto X" aunque la reserva haya
 * cambiado tres veces desde entonces, o borrado el proyecto su nombre.
 *
 * La única excepción es el `ticketKey` (`PROJ-N`), que se resuelve al leer con
 * un join a `tickets → projects`. Es seguro porque `enforce_project_key_immutable`
 * garantiza que la clave no cambia una vez que hay tickets — y si hay
 * notificación, hay ticket.
 */
export type NotificationPayload = {
  // Reservas
  project?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  response_note?: string | null;
  displaced_by_project?: string | null;
  displaced_by_booking?: string | null;
  // Tickets
  title?: string | null;
  project_id?: string | null;
  assigned_by?: string | null;
  previous_assignee_id?: string | null;
  changed_by?: string | null;
  from_status?: TicketStatus | string | null;
  to_status?: TicketStatus | string | null;
};

export type NotificationRow = {
  id: string;
  type: NotificationType;
  bookingId: string | null;
  ticketId: string | null;
  /**
   * `PROJ-N` resuelto en la query. `null` para avisos de bookings o cuando el
   * ticket referenciado no está más disponible (tickets se cancelan, no se
   * borran, pero un `service_role` podría; el aviso sobrevive porque
   * `on delete cascade` en la FK lo borraría solo, pero mientras exista sin
   * ticket, el key queda null).
   */
  ticketKey: string | null;
  payload: NotificationPayload;
  readAt: string | null;
  createdAt: string;
};

/**
 * Copy estático — los que no dependen de `ticketKey` en el título. Los dos de
 * tickets viven en `notificationTitle()` porque su título incluye la clave.
 */
const TITLE: Record<
  Exclude<NotificationType, "ticket_assigned" | "ticket_status_changed">,
  string
> = {
  booking_created: "Te reservaron tiempo",
  booking_approved: "Aprobaron tu reserva",
  booking_rejected: "Rechazaron tu reserva",
  booking_cancelled: "Cancelaron una reserva tuya",
  booking_needs_reapproval: "Cambió una reserva que habías aprobado",
  booking_displaced: "Te desplazaron una reserva",
};

/**
 * Título del aviso. `ticketKey` es opcional y solo se lee para los dos types
 * de tickets — los callers de bookings pueden seguir llamando con un solo
 * argumento sin cambios.
 */
export function notificationTitle(
  type: NotificationType,
  ticketKey?: string | null,
): string {
  if (type === "ticket_assigned") {
    return ticketKey ? `Te asignaron ${ticketKey}` : "Te asignaron un ticket";
  }
  if (type === "ticket_status_changed") {
    return ticketKey ? `${ticketKey}: cambió el estado` : "Cambió el estado de un ticket";
  }
  return TITLE[type];
}

/** `"Proyecto X · mar 14/10, 09:00–13:00"`, con lo que haya. */
export function describeSlot(payload: NotificationPayload, timeZone?: string): string {
  const parts: string[] = [];
  if (payload.project) parts.push(payload.project);

  if (payload.starts_at) {
    const start = new Date(payload.starts_at);
    const day = start.toLocaleDateString("es-AR", {
      weekday: "short",
      day: "numeric",
      month: "numeric",
      timeZone,
    });
    // `hourCycle: "h23"` como en `calendar/format.ts` y `calendar/range.ts`: sin
    // eso, `es-AR` sale en 12 horas («12:00 p. m.») y el aviso hablaría distinto
    // que la grilla que muestra la misma reserva.
    const from = start.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    });
    const to = payload.ends_at
      ? new Date(payload.ends_at).toLocaleTimeString("es-AR", {
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          timeZone,
        })
      : null;
    parts.push(to ? `${day}, ${from}–${to}` : `${day}, ${from}`);
  }

  return parts.join(" · ");
}

function statusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return TICKET_STATUS_LABELS[status as TicketStatus] ?? status;
}

/**
 * La segunda línea del aviso: lo que hay que saber sin abrir nada.
 *
 * El rechazo lleva el comentario y el desplazamiento nombra al proyecto que se
 * llevó la franja. Los dos son deliberados: un rechazo sin motivo, o un "te
 * desplazaron" sin decir quién, obligan a entrar a buscar lo que el aviso debía
 * ahorrarte — que es justo el problema que `010` viene a resolver.
 *
 * Los de tickets muestran el título y, para status changes, el par de estados
 * en español.
 */
export function notificationDetail(
  type: NotificationType,
  payload: NotificationPayload,
): string | null {
  if (type === "booking_rejected" && payload.response_note) {
    return `Motivo: ${payload.response_note}`;
  }
  if (type === "booking_displaced" && payload.displaced_by_project) {
    return `Se la llevó ${payload.displaced_by_project}, que es prioritario.`;
  }
  if (type === "booking_needs_reapproval") {
    return "Volvió a quedar pendiente de tu aprobación.";
  }
  if (type === "ticket_assigned" && payload.title) {
    return `"${payload.title}"`;
  }
  if (type === "ticket_status_changed") {
    const from = statusLabel(payload.from_status);
    const to = statusLabel(payload.to_status);
    if (payload.title && from && to) {
      return `"${payload.title}" pasó de ${from} a ${to}`;
    }
    if (from && to) return `${from} → ${to}`;
  }
  return null;
}

/**
 * A dónde lleva el aviso. Los tickets van a `/tickets/PROJ-N`; las reservas
 * al calendario, con la reserva deep-linked cuando existe.
 *
 * El input es la row entera (o al menos los dos identificadores) porque las
 * dos alternativas son excluyentes pero conviene expresarlas en la misma
 * firma para que el llamador no invente un tercer estado.
 */
export function notificationHref(
  row: Pick<NotificationRow, "bookingId" | "ticketKey">,
): string {
  if (row.ticketKey) return `/tickets/${row.ticketKey}`;
  return row.bookingId ? `/calendar?booking=${row.bookingId}` : "/calendar";
}

export function unreadCount(rows: Pick<NotificationRow, "readAt">[]): number {
  return rows.filter((row) => row.readAt === null).length;
}
