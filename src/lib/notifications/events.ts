/**
 * Los seis tipos de aviso, como unión y no leídos de `Database`.
 *
 * `notifications.type` es un `check` y no un enum de Postgres —misma decisión
 * que `bookings.status` en 004— así que el generador de tipos lo da como
 * `string`. Escribirlos acá es lo que hace que agregar un tipo nuevo rompa el
 * `Record` de abajo en vez de dejar un aviso sin texto.
 */
export const NOTIFICATION_TYPES = [
  "booking_created",
  "booking_approved",
  "booking_rejected",
  "booking_cancelled",
  "booking_needs_reapproval",
  "booking_displaced",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Lo que una notificación necesita saber para poder mostrarse **sin volver a la
 * base**. Se congela al escribir la fila, en el trigger: un aviso tiene que
 * poder decir "te sacaron el martes en Proyecto X" aunque la reserva haya
 * cambiado tres veces desde entonces, o borrado el proyecto su nombre.
 */
export type NotificationPayload = {
  project?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  response_note?: string | null;
  displaced_by_project?: string | null;
  displaced_by_booking?: string | null;
};

export type NotificationRow = {
  id: string;
  type: NotificationType;
  bookingId: string | null;
  payload: NotificationPayload;
  readAt: string | null;
  createdAt: string;
};

/**
 * El copy de cada tipo de aviso, en el vocabulario del PM y no en el de la base
 * (`DESIGN.md` §11).
 *
 * **Funciones puras y del lado de la app, aunque la fila la escriba la base.**
 * El trigger guarda los hechos —proyecto, franja, motivo— y no una oración
 * armada: si mañana cambia el texto, cambiarlo acá no obliga a una migration ni
 * deja los avisos viejos hablando distinto que los nuevos.
 */
const TITLE: Record<NotificationType, string> = {
  booking_created: "Te reservaron tiempo",
  booking_approved: "Aprobaron tu reserva",
  booking_rejected: "Rechazaron tu reserva",
  booking_cancelled: "Cancelaron una reserva tuya",
  booking_needs_reapproval: "Cambió una reserva que habías aprobado",
  booking_displaced: "Te desplazaron una reserva",
};

export function notificationTitle(type: NotificationType): string {
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

/**
 * La segunda línea del aviso: lo que hay que saber sin abrir nada.
 *
 * El rechazo lleva el comentario y el desplazamiento nombra al proyecto que se
 * llevó la franja. Los dos son deliberados: un rechazo sin motivo, o un "te
 * desplazaron" sin decir quién, obligan a entrar a buscar lo que el aviso debía
 * ahorrarte — que es justo el problema que `010` viene a resolver.
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
  return null;
}

/** A dónde lleva el aviso. Sin reserva, al calendario. */
export function notificationHref(bookingId: string | null): string {
  return bookingId ? `/calendar?booking=${bookingId}` : "/calendar";
}

export function unreadCount(rows: Pick<NotificationRow, "readAt">[]): number {
  return rows.filter((row) => row.readAt === null).length;
}
