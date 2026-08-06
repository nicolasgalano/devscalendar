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

### 2.1 La tabla `bookings` ya existe — la crea `003`

`003-calendar-ui` necesitaba renderizar reservas para poder cumplir sus propios acceptance criteria, así que la tabla nace ahí. El corte está documentado en `specs/features/003-calendar-ui/plan.md` §3.1:

| Qué | Feature |
| :---- | :---- |
| Tabla `bookings`, RLS de **lectura**, índices de rango, seed | `003` (migration `00000000000004_bookings.sql`) |
| Policies de escritura, `exclusion constraint` anti doble-booking, API de CRUD, máquina de estados | **`004` — esta feature** |

Consecuencias concretas para quien la implemente:

- **La tabla llega sin ninguna policy de escritura.** Hoy nadie puede insertar desde la app, ni un admin; solo `service_role` (seed y fixtures de test). La primera migration de `004` agrega las policies de `insert`/`update`/`delete` junto con el `exclusion constraint`. Esto es intencional, no un olvido: hay un test de integración en `003` que verifica que las escrituras fallan, y hay que actualizarlo acá.
- **El schema base ya está fijado:** `project_id`, `dev_id`, `created_by`, `starts_at`, `ends_at`, `status` (`check` con los 5 estados de la spec funcional §5.2), `note`, `ticket_ref`. Ver `003/plan.md` §3.2 antes de agregar columnas — la ausencia de una `priority` propia en la reserva es deliberada (se resuelve por join con `projects`).
- **El índice GiST sobre `tstzrange(starts_at, ends_at)`** no está creado: va junto al `exclusion constraint` de esta feature (AC-4.1).

Antes de arrancar, verificar que el schema que quedó en la migration de `003` coincide con lo de arriba.

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
- **AC-1.4** — Given un PM crea una reserva en un día no laborable (fin de semana o feriado argentino) **o** fuera de la jornada de 09:00 a 17:00, when guarda, then el sistema **advierte y permite continuar** — nunca bloquea. La reserva queda igual de válida que cualquier otra. Confirmado con el cliente el 2026-08-05 (Q-F, Q-G).
  - **Trabajar fuera de horario es excepcional, no habitual.** Esa es justamente la razón de advertir: si fuera rutina, el aviso sería ruido que se clickea sin leer; siendo raro, el aviso informa de verdad. Y es la razón de no bloquear: la excepción existe y el sistema no puede volverla imposible de registrar.
  - **Advertencia inline en el formulario, visible antes de guardar** — junto al campo de fecha y hora, no un toast posterior ni un modal de confirmación. Que el caso sea raro implica que el PM no lo tiene incorporado: el aviso tiene que llegar mientras todavía está eligiendo el horario, no después de haberlo hecho. Un modal de confirmación sería defendible por lo poco frecuente, pero el cliente pidió explícitamente advertencia sin bloqueo, y frenar el flujo por algo que no es destructivo ni irreversible (la reserva se edita o se cancela) no lo amerita.
  - La única validación dura sigue siendo la de AC-1.3 (`end > start`) y el anti doble-booking de US-4.

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
- Policies de escritura de `bookings` (la tabla la crea `003` sin ellas — ver §2.1).
- Constraint de exclusión en DB (probablemente `EXCLUDE USING gist` con `tstzrange` sobre `(dev_id, time_range)` filtrando por `status = 'approved'`).
- Validaciones aplicativas (fechas coherentes, ticket válido si se linkea, jornada y días laborables — ver Q-G).
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
- **Q-E** — ~~¿La edición de una reserva `approved` invalida la aprobación o solo notifica?~~ **Respondida el 2026-08-06:** cambios de horario o de desarrollador la devuelven a `pending`; cambios de nota o ticket no la tocan. Ver `plan.md` §4 y AC-2.2.
- **Q-G** — ~~(nueva, derivada de Q-F) ¿Qué hace el formulario si un PM quiere reservar fuera de 09:00–17:00 o en un día no laborable?~~ **Respondida por el cliente el 2026-08-05: solo advertencia, nunca bloqueo**, en los dos casos (día no laborable y horario fuera de la jornada). Ver AC-1.4.

---

## 8. Métricas de éxito

- 0 incidentes de doble-booking en producción (medido por reservas aprobadas superpuestas por dev).
- p95 de creación de reserva (validaciones incluidas) < 300ms.

---

## 9. Riesgos conocidos

- **R-1** — Constraint de exclusión mal escrito permite doble-booking bajo carga. **Mitigación:** test de concurrencia explícito (dos writes en paralelo) en el suite de integración.
- **R-2** — La edición mientras el dev aprueba genera race condition. **Mitigación:** version/etag en la reserva; el approve refiere a la versión que vio el dev.
