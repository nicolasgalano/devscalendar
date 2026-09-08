import { createClient } from "@/lib/supabase/server";
import type { NotificationPayload, NotificationRow, NotificationType } from "./events";

/** Cuántas trae la campana. Más que esto no entra en un popover ni se lee. */
const LIMIT = 15;

/**
 * Las notificaciones del usuario actual.
 *
 * **La RLS es la que filtra por destinatario**, no este query: la policy
 * `notifications: recipient read` es `recipient_id = auth.uid()`. Acá no hay
 * ningún `.eq("recipient_id", …)` a propósito — agregarlo daría la impresión de
 * que la seguridad vive en el query, y el día que alguien lo saque no pasaría
 * nada, que es peor que si pasara.
 */
export async function getMyNotifications(): Promise<NotificationRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, booking_id, payload, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type as NotificationType,
    bookingId: row.booking_id,
    payload: (row.payload ?? {}) as NotificationPayload,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}
