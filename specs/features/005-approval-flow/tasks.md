# Tasks — Approval flow (dev approve/reject)

- **ID:** 005-approval-flow
- **Plan reference:** `./plan.md`
- **Status:** ready to start.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

> **Alcance acordado con el usuario (2026-08-12):** sin notificaciones —AC-1.2 y AC-3.1 se difieren a `010`— y comentario **obligatorio al rechazar**. Ver `plan.md` §1.

---

## Phase 1 — Escritura del desarrollador

- [ ] **T1.1** — Migration `00000000000007_booking_responses.sql`, en un solo archivo (`plan.md` §12: separar la policy del guard abre una ventana en la que cualquier dev puede reescribir sus reservas):
  - Columnas `response_note text` y `responded_at timestamptz`, ambas nullable.
  - Policy `bookings: developer responds` (`plan.md` §3.2).
  - **Guard de columnas dentro de `enforce_booking_status_transition()`**, extendiendo la función de `004` en vez de agregar un trigger nuevo: dos triggers `before update` sobre la misma tabla se ejecutan por orden alfabético de nombre, y hacer depender una regla de seguridad de eso es pedirla prestada al azar.
  - _DoD: **CI primero** — el job `database` reconstruye la base desde cero (`supabase db reset --local`) y T3.2 queda en verde. Recién con el PR verde se aplica al proyecto remoto con `pnpm db:push`. Ver `docs/testing.md` §8: una migration rota tiene que descubrirse contra una base descartable, no contra la de desarrollo._
- [ ] **T1.2** — Trigger `bookings_log_status_change` → `audit_log` (`plan.md` §3.4). Mismo patrón que `projects_log_priority_change`: `security definer`, sin `grant insert` para nadie. _DoD: T3.5._
- [ ] **T1.3** — `pnpm db:types`. _DoD: `pnpm typecheck` limpio._
- [ ] **T1.4** — Ampliar `seed.sql` con reservas pendientes del dev del seed, para que la bandeja tenga contenido apenas se levanta el entorno. Mantener la idempotencia (`on conflict`), que ahora es requisito y no comodidad: el seed se corre sobre bases que ya tienen datos. _DoD: el stack efímero de CI queda con al menos tres pendientes de fechas distintas, y `pnpm db:seed` sobre el proyecto remoto corrido dos veces seguidas no falla ni duplica._

## Phase 2 — Reglas y API

- [ ] **T2.1** — Extender `src/lib/bookings/transitions.ts`: `canRespond(status)` y `nextStatusAfterResponse(...)`. Funciones puras, al lado de las de `004`. _DoD: T3.1._
- [ ] **T2.2** — Schema Zod de la respuesta en `src/lib/validation/bookings.ts`: `status` acotado a `approved | rejected`, `note` **obligatorio si `rejected`** y opcional si `approved`, `expectedUpdatedAt` requerido. _DoD: T3.1._
- [ ] **T2.3** — Guard `requireBookingResponder(bookingId)` en `src/lib/api/`, hermano de `requireBookingAccess()`: 401 sin sesión, 403 si quien llama no es el dev asignado. _DoD: T3.2._
- [ ] **T2.4** — `PATCH /api/bookings/[id]/response`. Body con `readJsonBody()`, **nunca `request.json()`** (convención de `CLAUDE.md`). Las tres traducciones de error de `plan.md` §4:
  - `23P01` → 409 con `findConflictingBooking()`, reusado de `004`;
  - `check_violation` del trigger → 403;
  - `expectedUpdatedAt` desajustado → 409 con la reserva actual.
  - _DoD: T3.2, T3.3, T3.4._

## Phase 3 — Tests

- [ ] **T3.1** — Unit: transiciones de respuesta y schema Zod. Caso central: **rechazar sin comentario falla, aprobar sin comentario no**. _DoD: corren sin Supabase._
- [ ] **T3.2** — **Integración, el test que no puede faltar (R-1):** el dev **no** puede cambiar `starts_at`, `ends_at`, `dev_id`, `note` ni `ticket_ref` de su propia reserva, y **sí** puede cambiar `status` y `response_note`.
  - Verificar **leyendo la fila de vuelta**, no solo por el error: si algún día la policy denegara en vez de tirar, la RLS convierte el `update` en un no-op silencioso y un test que solo mire el error pasaría por la razón equivocada (la lección de `004` T4.2).
  - Más: el dev responde la suya; **no** responde la de otro; el PM sigue sin poder aprobar (regresión del guard de `004`); un admin que además es el dev asignado **sí** puede editar.
- [ ] **T3.3** — Integración del conflicto: aprobar sobre una franja ya aprobada del mismo dev → `23P01`, y la API lo devuelve como 409 **con la reserva que bloquea**. Es la primera vez que el constraint de `004` se dispara de verdad.
- [ ] **T3.4** — Integración de la carrera (R-2): el PM edita, el dev responde con el `expectedUpdatedAt` viejo, la respuesta es 409 y **la reserva sigue `pending`**.
- [ ] **T3.5** — Integración de auditoría: aprobar y rechazar escriben su fila en `audit_log` con `from`, `to` y el motivo.
- [ ] **T3.6** — **Concurrencia (R-4):** dos aprobaciones en paralelo sobre franjas superpuestas del mismo dev; exactamente una persiste. _DoD: en paralelo, no en serie — en serie pasa hasta un check aplicativo._

## Phase 4 — UI

- [ ] **T4.1** — Ruta `/(app)/inbox/` con guard de rol `developer` en su `layout.tsx`, siguiendo el patrón de `(app)/admin/layout.tsx`. Item de navegación visible solo para devs. _DoD: un PM que entra a mano a `/inbox` no la ve._
- [ ] **T4.2** — La lista (AC-1.1): pendientes del dev ordenadas por `starts_at`, con proyecto, cliente, franja y la nota del PM. Filas de 36px. _DoD: los cuatro estados de datos de `DESIGN.md` §9._
- [ ] **T4.3** — Aprobar: un clic, sin diálogo. `Aprobar` es la acción primaria de la vista; `Rechazar` secundaria con texto en `--danger` (`DESIGN.md` §7).
- [ ] **T4.4** — Diálogo de rechazo con comentario **obligatorio**. Validar al usar el botón, no deshabilitándolo — misma decisión que `004` T3.1.
- [ ] **T4.5** — `Aprobar` / `Rechazar` en el popover del bloque del calendario cuando el que mira es el dev asignado y la reserva está `pending`. Reusa `BookingActionsProvider`. _DoD: el PM sigue viendo `Editar` / `Cancelar` y nada más._
- [ ] **T4.6** — Estado de conflicto y de carrera en la UI: el 409 del constraint muestra la reserva que bloquea (componente de `004`); el 409 de `expectedUpdatedAt` dice que la reserva cambió y refresca la bandeja. _DoD: el motivo siempre en palabras, nunca solo color._
- [ ] **T4.7** — E2E: el dev entra a la bandeja, aprueba una, rechaza otra con comentario, y el PM ve los dos estados en el calendario. Más el caso de la carrera.
  - **Calentamiento de rutas autenticado** en `beforeAll`, como en `004` T4.5: `next dev` compila cada handler la primera vez y eso se come la primera aserción.
  - Fixtures propias y **una fecha por test** (`fullyParallel` está activo).

## Phase 5 — Docs & handoff

- [ ] **T5.1** — `CLAUDE.md`: sumar a la sección "Reservas" que el dev ya escribe, acotado a `status` y `response_note` **por trigger, no por policy**, y por qué.
- [ ] **T5.2** — `DESIGN.md` §14: lo que `005` aplique del sistema.
- [ ] **T5.3** — `specs/features/README.md`: `005` a `done`. Cerrar Q-5 y dejar Q-6 apuntando a `006`.
- [ ] **T5.4** — ADR solo si aparece algo transversal. **Candidato probable:** que la autorización por columna se resuelva con trigger porque la RLS de Postgres no la expresa — lo heredan `006` (realocación escribe `status`) y `010`.
- [ ] **T5.5** — Revisión visual en ambos temas, a 1280 / 1440 / <1024px. Necesita ojos humanos.

---

## Blocked / follow-ups

- [ ] **F1** — **Notificaciones (AC-1.2, AC-2.1 parcial, AC-3.1).** Diferidas a `010` por decisión del 2026-08-12. Hasta entonces el dev se entera entrando a la app. **No simularlas con un toast:** dejaría la ilusión de que la otra persona se enteró. Hereda también el badge de pendientes en el nav.
- [ ] **F2** — **Push a Google Calendar al aprobar** (AC-2.1) — es `007`. `005` deja el evento en `audit_log`, que es de donde `007` puede colgarse.
- [ ] **F3** — **Deshacer una respuesta.** Hoy solo se responde una reserva `pending` (`plan.md` §3.3). Que el dev se desdiga es una conversación con el PM, no un botón; si el cliente lo pide después de usarlo, la regla se relaja en `nextStatusAfterResponse` y en el trigger, no en el modelo.
- [ ] **F4** — Q-6 (¿la realocación por prioridad saltea la aprobación del dev?) sigue abierta y ahora **es de `006`**: acá el default es que el dev siempre aprueba.
- [ ] **F5** — Q-F de `spec.md` §7: sin timeout de aprobación en el MVP. El recordatorio pasadas X horas necesita `010`.
- [ ] **F6** — `audit_log` solo lo lee el admin. Que el PM vea el historial de su reserva —quién la aprobó y cuándo— es de `010`.
