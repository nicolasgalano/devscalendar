# Spec — Bookings CRUD (con anti doble-booking)

- **ID:** 004-bookings
- **Estado:** draft
- **Referencias en la spec funcional:** §5 (módulo reservas), §9 (caso de uso principal), §12 (concurrencia no funcional)

---

## 1. Objetivo

Permitir a los PMs crear, editar y cancelar reservas (bloques) asignando un dev a un proyecto en una franja horaria, con prevención estricta de doble-booking a nivel de base de datos.

---

## 2. Contexto

Es el core transaccional del sistema. Todo lo demás (aprobación, prioridad, integraciones) se apoya en la existencia consistente de reservas sin conflictos.

---

## 3. User stories

- **US-1** — Como PM, quiero crear una reserva indicando dev, proyecto, franja horaria y ticket asociado, para bloquear tiempo del dev sobre mi proyecto.
- **US-2** — Como PM, quiero editar una reserva pendiente (mover horario, cambiar ticket, ajustar nota), para corregir sin recrearla.
- **US-3** — Como PM, quiero cancelar una reserva, para liberar el tiempo del dev.
- **US-4** — Como sistema, quiero impedir que dos reservas aprobadas del mismo dev se superpongan en tiempo, para evitar el doble-booking.

---

## 4. Acceptance criteria

### US-1

- **AC-1.1** — Given un PM, when crea una reserva con dev+proyecto+franja válida, then queda persistida en estado `pending`.
- **AC-1.2** — Given un PM intenta reservar a un dev en una franja donde ya tiene una reserva aprobada, when guarda, then el sistema rechaza la operación indicando el conflicto (incluye link a la reserva conflictiva).
- **AC-1.3** — Given un PM crea una reserva con `end <= start`, then falla con validación de negocio antes de tocar la DB.

### US-2

- **AC-2.1** — Given una reserva `pending`, when el PM la mueve a otro horario que no genera conflicto, then se persiste el cambio y se re-notifica al dev.
- **AC-2.2** — Given una reserva `approved`, when el PM la edita, then el sistema le muestra que el cambio requerirá re-aprobación del dev (o rechaza el cambio, según decisión).

### US-3

- **AC-3.1** — Given una reserva en cualquier estado (excepto `displaced` o `cancelled`), when el PM la cancela, then pasa a `cancelled` y se notifica al dev si estaba aprobada o pending.

### US-4 (crítica — no negociable)

- **AC-4.1** — Given dos requests concurrentes que intentan reservar al mismo dev en la misma franja, when ambos llegan a la DB, then **exactamente uno** persiste y el otro falla con error de conflicto. Se garantiza por constraint DB o transacción serializable, no por check aplicativo.
- **AC-4.2** — Given una reserva `pending` de dev X para franja F, when llega otra reserva `pending` de dev X para franja F', y F y F' se superponen, then ambas conviven en estado pending (el conflicto se materializa recién al aprobar).

---

## 5. Alcance

### Dentro

- Crear / editar / cancelar reservas.
- Constraint de exclusión en DB (probablemente `EXCLUDE USING gist` con `tstzrange` sobre `(developer_id, time_range)` filtrando por `status = 'approved'`).
- Validaciones aplicativas (fechas coherentes, ticket válido si se linkea, etc.).
- Asociación de ticket Jira/Slack (feature 008/009 lo profundiza; acá se guarda el ref).

### Fuera (explícito)

- Flujo de aprobación del dev (feature 005).
- Realocación por prioridad (feature 006).
- Drag & drop en el calendario para mover reservas — se puede diferir a un follow-up.

---

## 6. Dependencias

- **001-auth-and-permissions** (RLS para "quién puede crear en qué proyecto").
- **002-entities-admin** (necesita devs, proyectos, PMs).
- **003-calendar-ui** (aunque la UI del calendario es dueña del listado, el modal/form de reserva vive acá o en un módulo compartido).

---

## 7. Preguntas abiertas

- **Q-8** (de spec §11) — Unidad de reserva: ¿franja libre o bloques fijos? **Recomendación por defecto:** franja libre (start/end), como Google Calendar.
- **Q-10** (de spec §11) — Multi-timezone: fechas siempre en UTC en DB. **Bloquea:** confirmar TZ del proyecto para display si es multi-TZ.
- **Q-E** — ¿La edición de una reserva `approved` invalida la aprobación o solo notifica? **Recomendación por defecto:** cambios de horario o dev invalidan (vuelve a `pending`); cambios de nota/ticket no.

---

## 8. Métricas de éxito

- 0 incidentes de doble-booking en producción (medido por reservas aprobadas superpuestas por dev).
- p95 de creación de reserva (validaciones incluidas) < 300ms.

---

## 9. Riesgos conocidos

- **R-1** — Constraint de exclusión mal escrito permite doble-booking bajo carga. **Mitigación:** test de concurrencia explícito (dos writes en paralelo) en el suite de integración.
- **R-2** — La edición mientras el dev aprueba genera race condition. **Mitigación:** version/etag en la reserva; el approve refiere a la versión que vio el dev.
