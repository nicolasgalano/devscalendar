/**
 * Dispara el drenaje de la cola de emails **sin esperarlo**.
 *
 * Es el camino del 99%: el aviso sale en segundos en vez de esperar al cron. Lo
 * que lo hace seguro es que no importa si falla — la fila ya está escrita, y el
 * cron levanta lo que quedó `pending`. Por eso no se `await`ea y por eso el
 * error se traga: hacer que la creación de una reserva dependa de que el
 * proveedor de email esté vivo sería exactamente el R-1 que el diseño evita.
 *
 * En desarrollo, sin `CRON_SECRET` ni URL del sitio, no hace nada y no se queja.
 */
export function dispatchNotifications(): void {
  const secret = process.env.CRON_SECRET;
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!secret || !site) return;

  void fetch(`${site}/api/notifications/dispatch`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  }).catch(() => undefined);
}
