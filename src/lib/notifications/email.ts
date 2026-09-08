import {
  describeSlot,
  notificationDetail,
  notificationTitle,
  type NotificationPayload,
  type NotificationType,
} from "@/lib/notifications/events";

/**
 * El canal de email, detrás de una interfaz de una función.
 *
 * Existe así por R-4 de la spec: depender de un tercero está bien, depender de
 * él *en todos lados* no. Cambiar de proveedor tiene que ser reescribir esto y
 * nada más.
 *
 * **Sin `RESEND_API_KEY` configurada no se rompe nada:** devuelve `skipped` y
 * las filas se quedan `pending`. La bandeja in-app funciona igual, y CI no
 * necesita credenciales de nadie para correr la suite entera — que es la otra
 * mitad de por qué el envío vive de este lado de la línea y no adentro de la
 * escritura de la reserva.
 */
export type EmailResult =
  { status: "sent" } | { status: "skipped"; reason: string } | { status: "failed"; error: string };

const ENDPOINT = "https://api.resend.com/emails";

export function emailSubject(type: NotificationType, payload: NotificationPayload): string {
  const slot = describeSlot(payload);
  return slot ? `${notificationTitle(type)} — ${slot}` : notificationTitle(type);
}

/**
 * El cuerpo, en texto plano y corto a propósito (Q-R1): proyecto, franja, el
 * motivo si lo hay, y un link. Nada que no esté ya en la app.
 *
 * Vale recordar por qué es corto: un email sale del producto y no vuelve. No se
 * corrige, no se retira, y llega a la bandeja personal de cada uno.
 */
export function emailBody(
  type: NotificationType,
  payload: NotificationPayload,
  href: string,
): string {
  const lines = [notificationTitle(type)];

  const slot = describeSlot(payload);
  if (slot) lines.push(slot);

  const detail = notificationDetail(type, payload);
  if (detail) lines.push(detail);

  lines.push("", `Ver en DevsCalendar: ${href}`);
  return lines.join("\n");
}

export async function sendEmail(message: {
  to: string;
  subject: string;
  body: string;
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATIONS_FROM_EMAIL;

  if (!apiKey || !from) {
    return { status: "skipped", reason: "email no configurado" };
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.body,
      }),
    });

    if (!response.ok) {
      // El cuerpo del error del proveedor se guarda para poder diagnosticar, pero
      // acotado: `email_error` es una columna de diagnóstico, no un log.
      const detail = await response.text().catch(() => "");
      return { status: "failed", error: `${response.status} ${detail}`.slice(0, 300) };
    }

    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "error desconocido",
    };
  }
}
