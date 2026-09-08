import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { emailBody, emailSubject, sendEmail } from "@/lib/notifications/email";
import {
  notificationHref,
  type NotificationPayload,
  type NotificationType,
} from "@/lib/notifications/events";
import type { Database } from "@/types/database";

/** Cuántas se drenan por corrida. Con un equipo chico sobra, y acota el timeout. */
const BATCH = 25;

/** Después de esto se deja de reintentar y la fila queda `failed` para siempre. */
const MAX_ATTEMPTS = 5;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);

  // Comparación de largo constante: sin esto, el tiempo de respuesta filtra
  // cuántos caracteres del secreto acertó quien prueba.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * Drena la cola de emails pendientes.
 *
 * **No se autentica con sesión** porque lo llama un cron, y por eso mismo
 * **nunca devuelve el contenido de las notificaciones**: solo cuántas mandó y
 * cuántas fallaron. Un endpoint que drena mensajes ajenos no puede ser, además,
 * una forma de leerlos.
 *
 * Usa `service_role` a propósito y es uno de los pocos lugares donde
 * corresponde (`CLAUDE.md`): tiene que leer notificaciones de todos y el email
 * de sus destinatarios, que es exactamente lo que la RLS le niega a cualquier
 * sesión — incluida la de un admin.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Faltan credenciales de servidor" }, { status: 500 });
  }

  const admin = createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // **El update es el que reclama la fila, no un select previo** (R-3 del plan):
  // pasa a `sending` con `returning`, así que si el drenaje inline y el cron
  // corren a la vez, cada uno se lleva filas distintas y nadie manda dos veces
  // el mismo aviso.
  const { data: claimed, error: claimError } = await admin
    .from("notifications")
    .update({ email_status: "sending" })
    .eq("email_status", "pending")
    .lt("email_attempts", MAX_ATTEMPTS)
    .select(
      "id, type, payload, booking_id, email_attempts, recipient:profiles!inner(email, active)",
    )
    .limit(BATCH);

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of claimed ?? []) {
    const recipient = row.recipient as unknown as { email: string; active: boolean };

    // AC-1.7: dar de baja a alguien deja de escribirle. `skipped` y no `failed`
    // a propósito — no es un fallo, es una decisión, y mezclarlos haría que un
    // reintento le mande un mail a una cuenta desactivada.
    if (!recipient?.active) {
      await admin
        .from("notifications")
        .update({ email_status: "skipped", email_error: "destinatario desactivado" })
        .eq("id", row.id);
      skipped++;
      continue;
    }

    // `notifications.type` es un `check` en la base, así que el generador lo da
    // como `string`; la unión vive en `events.ts` y es la que hace que agregar
    // un tipo nuevo rompa el compilador en vez de mandar un mail sin texto.
    const type = row.type as NotificationType;
    const payload = (row.payload ?? {}) as NotificationPayload;
    const href = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}${notificationHref(row.booking_id)}`;

    const result = await sendEmail({
      to: recipient.email,
      subject: emailSubject(type, payload),
      body: emailBody(type, payload, href),
    });

    if (result.status === "sent") {
      await admin
        .from("notifications")
        .update({ email_status: "sent", email_sent_at: new Date().toISOString() })
        .eq("id", row.id);
      sent++;
    } else if (result.status === "skipped") {
      // Sin proveedor configurado. Vuelve a `pending` en vez de quedar marcada:
      // el día que exista la key, estos avisos salen solos.
      await admin
        .from("notifications")
        .update({ email_status: "pending", email_error: result.reason })
        .eq("id", row.id);
      skipped++;
    } else {
      const attempts = (row.email_attempts ?? 0) + 1;
      await admin
        .from("notifications")
        .update({
          email_status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          email_attempts: attempts,
          email_error: result.error,
        })
        .eq("id", row.id);
      failed++;
    }
  }

  return NextResponse.json({ claimed: claimed?.length ?? 0, sent, failed, skipped });
}
