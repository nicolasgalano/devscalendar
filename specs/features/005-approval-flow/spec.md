# Spec — Approval flow (dev approve/reject)

- **ID:** 005-approval-flow
- **Estado:** draft
- **Referencias en la spec funcional:** §6 (flujo de aprobación), §9 (caso de uso principal)

---

## 1. Objetivo

Convertir una reserva `pending` creada por un PM en un compromiso formal del desarrollador (`approved`) o en un rechazo (`rejected`), a través de una acción explícita del dev, con notificación en cada paso.

---

## 2. Contexto

Sin aprobación explícita del dev, una reserva es solo una intención del PM. Este flujo es lo que le da valor de compromiso al sistema y habilita el push a Google Calendar (feature 007).

---

## 3. User stories

- **US-1** — Como Dev, quiero ver mis reservas pendientes en una bandeja/vista, para no perderme ninguna.
- **US-2** — Como Dev, quiero aprobar o rechazar una reserva pendiente, con la opción de dejar un comentario, para confirmar mi compromiso o explicar el rechazo.
- **US-3** — Como PM, quiero ser notificado cuando el dev responde, para saber si tengo que reasignar.

---

## 4. Acceptance criteria

### US-1

- **AC-1.1** — Given un dev, when abre su vista de reservas pendientes, then ve todas sus reservas en estado `pending` ordenadas por fecha de inicio.
- **AC-1.2** — Given una reserva recién creada por un PM, when se crea, then el dev es notificado por los canales configurados (in-app + Slack, o los que apliquen — ver feature 010).

### US-2

- **AC-2.1** — Given una reserva `pending` del dev, when el dev aprueba, then pasa a `approved`, se dispara la creación del evento en Google Calendar (feature 007) y el PM es notificado.
- **AC-2.2** — Given una reserva `pending` del dev, when el dev rechaza con comentario, then pasa a `rejected`, el PM es notificado con el comentario, y la reserva ya no cuenta para prevención de doble-booking.
- **AC-2.3** — Given una reserva `approved` que fue posteriormente editada por el PM cambiando horario o dev, when se guarda la edición, then vuelve a `pending` y se re-notifica al dev (ver feature 004 AC-2.2).

### US-3

- **AC-3.1** — Given un dev aprueba o rechaza, when la transición se persiste, then el PM creador recibe notificación por los canales configurados.

---

## 5. Alcance

### Dentro

- Vista "mis reservas pendientes" para el dev.
- Acciones de aprobar / rechazar (con comentario opcional al rechazar; obligatorio con recomendación por default).
- Transiciones de estado válidas y auditadas.
- Notificación in-app al PM y al dev en cada transición.

### Fuera (explícito)

- Aprobar/rechazar directamente desde Slack (feature 009, opcional).
- Aprobar múltiples reservas de una — Fase 2 si aparece la necesidad.
- Delegación de aprobación a otro dev en ausencia — fuera de MVP.

---

## 6. Dependencias

- **004-bookings** (las reservas existen y tienen estados).
- **010-notifications-and-audit** (canal in-app; Slack/email pueden llegar después).

---

## 7. Preguntas abiertas

- **Q-1** (de spec §11) — ¿La realocación por prioridad saltea la aprobación del dev? **Recomendación por defecto:** no, el dev siempre aprueba. **Bloquea:** interacción con feature 006.
- **Q-9** (de spec §11) — Canales de notificación: in-app + Slack + email. **Recomendación por defecto:** in-app + Slack; email opcional. **Bloquea:** feature 010.
- **Q-F** — ¿Timeout para aprobar? Si el dev no responde en X horas, ¿qué pasa? **Recomendación por defecto:** MVP sin timeout; solo recordatorio pasado X horas. Registrar en tabla de auditoría para métrica.

---

## 8. Métricas de éxito

- % de reservas aprobadas dentro de las 24 hs de creadas ≥ 80% (indicador de fricción del flujo).
- Latencia del evento en Google Calendar del dev desde el approve < 30s (feature 007).
