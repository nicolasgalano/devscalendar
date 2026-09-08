-- Feature: 010-notifications-and-audit
-- Purpose: add the 'sending' state to notifications.email_status.
--
-- Corrige un error de la migration 11, escrito en el mismo día y detectado antes
-- de que la feature saliera: el `check` original permitía
-- pending/sent/failed/skipped, pero el dispatch **reclama** la fila pasándola a
-- un estado intermedio antes de llamar al proveedor. Sin ese estado, el `update`
-- que reclama viola el constraint y el drenaje no arranca.
--
-- Va como migration aparte y no editando la 11 porque la 11 ya está aplicada:
-- una migration aplicada no se reescribe, se corrige con otra. Es aditiva y la
-- tabla está vacía —nada la usa todavía—, así que no hay dato que migrar.
--
-- Por qué existe el estado intermedio, para que no parezca de más: el drenaje
-- corre por dos caminos —inline después de escribir la reserva, y por cron como
-- red de seguridad— y sin reclamar la fila los dos podrían mandar el mismo aviso
-- dos veces. Es R-3 del plan.

alter table public.notifications
  drop constraint notifications_email_status_check;

alter table public.notifications
  add constraint notifications_email_status_check
  check (email_status in ('pending', 'sending', 'sent', 'failed', 'skipped'));

-- El índice de la cola sigue mirando solo `pending`: una fila en `sending` ya la
-- reclamó alguien y no hay que volver a levantarla.
comment on column public.notifications.email_status is
  'pending: en cola · sending: reclamada por un dispatch · sent · failed: agotó '
  'los reintentos · skipped: destinatario desactivado, o proveedor sin configurar';
