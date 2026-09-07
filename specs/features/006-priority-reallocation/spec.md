# Spec — Priority & reallocation

- **ID:** 006-priority-reallocation
- **Estado:** done — 2026-09-03, salvo AC-2.1 (notificar al PM desplazado), diferido a `010`
- **Referencias en la spec funcional:** §7 (jerarquía de prioridad y realocación)

---

## 1. Objetivo

Permitir que un proyecto marcado como **prioritario** reserve tiempo de un dev que ya estaba reservado por un proyecto **común**, desplazando la reserva anterior (que pasa a `displaced`) y notificando a los afectados, sin permitir el caso inverso.

---

## 2. Contexto

Este es el diferenciador de negocio principal después del calendario base: refleja que en la vida real hay urgencias que justifican mover recursos, y evita que el PM prioritario tenga que mendigar el bloque al PM anterior.

---

## 3. User stories

- **US-1** — Como PM de un proyecto prioritario, quiero reservar a un dev incluso si ya está tomado por un proyecto común, para poder responder a urgencias sin negociación previa.
- **US-2** — Como PM de un proyecto común, quiero ser notificado inmediatamente cuando una reserva mía es desplazada, para poder reasignar y comunicar a mi equipo.
- **US-3** — Como Dev, quiero recibir la nueva reserva prioritaria como una nueva aprobación (no aprobada automáticamente), para confirmar que efectivamente puedo hacerla.

---

## 4. Acceptance criteria

### US-1

- **AC-1.1** — Given un PM prioritario intenta reservar a un dev en una franja donde el dev tiene una reserva `approved` de un proyecto común, when guarda, then la reserva común pasa a `displaced` y la nueva queda en `pending` (esperando aprobación del dev).
- **AC-1.2** — Given un PM común intenta reservar a un dev en una franja donde el dev tiene reserva de un proyecto prioritario, when guarda, then el sistema **rechaza** la operación con un mensaje claro ("bloque ocupado por proyecto prioritario X").
- **AC-1.3** — Given dos proyectos ambos prioritarios en conflicto, when se intenta la reserva, then el sistema **rechaza** y sugiere resolución manual (no hay override automático).

### US-2

- **AC-2.1** — Given una reserva es desplazada, when la transición ocurre, then el PM de la reserva anterior recibe notificación indicando: dev, franja, proyecto que desplazó y PM responsable del proyecto prioritario.
- **AC-2.2** — Given una reserva `displaced`, when se consulta el calendario con filtro `estado = displaced`, then aparece marcada visualmente para trazabilidad.

### US-3

- **AC-3.1** — Given una reserva creada por realocación, when se crea, then queda en `pending` — nunca se auto-aprueba (ver decisión Q-1).
- **AC-3.2** — Given el dev rechaza la nueva reserva prioritaria, when se rechaza, then el PM prioritario es notificado. La reserva desplazada **no se restaura automáticamente** — queda `displaced` (decisión: la restauración manual está fuera de MVP).

---

## 5. Alcance

### Dentro

- Modelado de dos niveles de prioridad (`priority` / `common`) en `projects`.
- Lógica de realocación en el creador de reservas.
- Nuevo estado `displaced` y sus reglas.
- Notificaciones al PM desplazado y al dev.
- Registro en `audit_log` de toda realocación.

### Fuera (explícito)

- Restauración automática de reservas desplazadas si la prioritaria se cancela — Fase 2.
- Esquema numérico de prioridad P0–P3 — Fase 2 (Q-2).
- Resolución automática de conflictos entre prioritarios.

---

## 6. Dependencias

- **004-bookings** — sin bookings no hay qué realocar.
- **005-approval-flow** — la reserva realocada entra al flujo normal de aprobación.
- **010-notifications-and-audit** — canal para notificar al PM desplazado + audit.

---

## 7. Preguntas abiertas

**Todas cerradas.** Ver el índice en `specs/features/README.md`.

- **Q-1** (de spec §11) — ~~¿La realocación saltea la aprobación del dev?~~ Ya cubierta: el dev siempre aprueba, incluso en realocación.
- **Q-2** (de spec §11) — ~~¿2 niveles alcanzan o hace falta P0–P3?~~ **Respondida el 2026-09-07: dos niveles.** Con eso, **el empate entre dos prioritarios no se resuelve solo y sigue yendo a los PMs** con el error `DC002` (AC-1.3). Si el empate resulta ser el caso común, la respuesta cambia: es una migration simple sobre el `check` de `priority` (`002/plan.md` §9), pero arrastra `canDisplace()` y el sistema de color de `DESIGN.md` §3.
- **Q-O** — ~~Cuando una reserva se desplaza y luego la prioritaria se cancela, ¿la desplazada se restaura?~~ **Respondida el 2026-09-07: no se restaura.** El PM anterior decide si reasigna. `reallocate_booking()` no guarda de quién tomó la franja más allá del `audit_log`, y restaurar automáticamente exige saber si la franja sigue libre — o sea, una segunda realocación.
  - **Se llamaba `Q-G` hasta el 2026-09-07**, que es el identificador de otra pregunta —reservar fuera de la jornada, en `004`, respondida el 2026-08-05—. Renombrada para que el índice no tenga dos preguntas con el mismo nombre.

---

## 8. Métricas de éxito

- 100% de realocaciones auditadas (fila en `audit_log`).
- 0 casos de reservas silenciosamente perdidas (aprobadas → desaparecidas sin `displaced`).

---

## 9. Riesgos conocidos

- **R-1** — Bug en la lógica de realocación puede tumbar reservas críticas sin dejar rastro. **Mitigación:** el estado `displaced` + `audit_log` deben estar antes de habilitar esta feature en producción. Tests explícitos.
