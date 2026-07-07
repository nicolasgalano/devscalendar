# Spec — Slack integration

- **ID:** 009-slack-integration
- **Estado:** draft
- **Referencias en la spec funcional:** §8.3 (Slack)

---

## 1. Objetivo

Enviar notificaciones de asignación / aprobación / realocación a los usuarios en Slack, y permitir asociar un canal o hilo de Slack como referencia de contexto de una reserva.

---

## 2. Contexto

Slack es donde el equipo ya conversa. Las notificaciones ahí tienen mucha más tasa de respuesta que emails, y asociar el hilo/canal donde nació el pedido da contexto útil sin duplicar información.

---

## 3. User stories

- **US-1** — Como Dev o PM, quiero recibir en Slack las notificaciones relevantes (nueva reserva pendiente, aprobación/rechazo, desplazamiento), para no tener que abrir DevsCalendar constantemente.
- **US-2** — Como PM, quiero linkear un canal o hilo de Slack a una reserva, para referenciar el contexto (ej. "salió de este hilo en #proyecto-alpha").
- **US-3** — Como Dev (opcional MVP), quiero poder aprobar o rechazar una reserva directamente desde el mensaje de Slack, sin ir al sitio.

---

## 4. Acceptance criteria

### US-1

- **AC-1.1** — Given un usuario tiene su cuenta Slack linkeada, when hay una notificación para él (creada por feature 010), then recibe un DM con el contenido relevante y un link a DevsCalendar.
- **AC-1.2** — Given un usuario no tiene Slack linkeado, when se genera una notificación, then el sistema no falla; usa los canales disponibles (in-app siempre; email si está configurado).

### US-2

- **AC-2.1** — Given un PM crea una reserva, when tiene el checkbox "asociar Slack", then puede pegar un link a un mensaje o seleccionar un canal.
- **AC-2.2** — Given una reserva con Slack asociado, when se abre el detalle, then hay un botón "ir al hilo" que abre Slack directamente.

### US-3 (opcional MVP)

- **AC-3.1** — Given un dev recibe una notificación de reserva pendiente en Slack, when clickea "aprobar" o "rechazar" en el mensaje, then la acción se ejecuta como si la hubiera hecho en la UI (con confirmación en el mismo mensaje).

---

## 5. Alcance

### Dentro

- Integración vía Slack Web API (DMs) y opcionalmente Events API para US-3.
- Linkeo de cuenta Slack por usuario (Sign-in with Slack o mapeo por email).
- Asociación de canal/hilo a la reserva (guardar link/ref).

### Fuera (explícito)

- Sincronización de canales de Slack como fuente de proyectos.
- Mensajes en canales públicos (solo DMs en MVP para evitar spam).
- Multi-workspace de Slack — asumir un workspace por instalación en MVP.

---

## 6. Dependencias

- **004-bookings** (campo `external_ref` extendido para Slack).
- **005-approval-flow** (fuente de notificaciones a enviar).
- **010-notifications-and-audit** (bus de notificaciones — Slack es un canal más).

---

## 7. Preguntas abiertas

- **Q-4** (de spec §11) — Ambos (Jira y Slack) configurables por proyecto. Consistente con feature 008.
- **Q-K** — ¿US-3 (aprobar desde Slack) en MVP o Fase 2? **Recomendación por defecto:** Fase 2 — agrega complejidad de Events API + verify signatures y no es crítico para el caso de uso principal.
- **Q-L** — ¿Multi-workspace en el futuro? **Recomendación por defecto:** diseñar el modelo con `workspace_id` desde el inicio aunque en MVP haya solo uno, para no re-migrar después.

---

## 8. Métricas de éxito

- ≥ 80% de devs con Slack linkeado en el primer mes.
- Tasa de respuesta a notificaciones de aprobación via Slack (si US-3 se implementa) ≥ 60%.
