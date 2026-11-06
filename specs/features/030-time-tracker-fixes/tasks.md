# Tasks — Time tracker correcciones post-launch

- **ID:** 030-time-tracker-fixes
- **Plan reference:** `./plan.md`
- **Status:** todo

Task format: `[ ]` open, `[x]` done, `[~]` in progress, `[!]` blocked. Phases are independently mergeable and deployable.

---

## Phase 1 — SQL + validation + handlers

- [ ] **T1.1** — Migration 27: `alter table active_timers add column description text;` + `create or replace function stop_timer(...)` con `v_minutes := least(960, greatest(15, ...));` y pasar `v_timer.description` al insert. _DoD: migration pasa con `pnpm db:push`; stop_timer con un active_timer de 48h genera un entry de 960 min sin error._
- [ ] **T1.2** — `src/lib/validation/time-entries.ts`: agregar `project_id` opcional a `updateTimeEntrySchema`. Agregar nuevo `updateActiveTimerSchema` con `{project_id?, ticket_id?, activity_id?, started_at?, description?}`. Export `UpdateActiveTimerInput`. _DoD: Zod compila; schemas rechazan payloads inválidos (uuid malformado, started_at mal formado)._
- [ ] **T1.3** — `src/app/api/time-entries/[id]/route.ts`: aceptar `project_id` en PATCH. Si cambió, re-chequear `can_view_project` del nuevo. Validar ticket + activity contra el proyecto final. Agregar `project_id` al `.update()` spread. _DoD: PATCH con project_id nuevo retorna 200; con proyecto donde no soy member retorna 403; con ticket que no pertenece al nuevo proyecto retorna 400._
- [ ] **T1.4** — `src/app/api/time-entries/timer/start/route.ts`: antes del RPC, leer `active_timers`. Si existe, responder `409 { reason: 'timer_active', timer }`. _DoD: con un timer activo, segundo POST a /timer/start devuelve 409 sin tocar la base._
- [ ] **T1.5** — Nuevo `src/app/api/time-entries/timer/route.ts` con PATCH. Validaciones análogas al start + chequeo de `started_at` no futuro. `.update()` sobre `active_timers` filtrado por `user_id`. _DoD: PATCH cambia campos del timer activo; con proyecto nuevo re-valida membership; con started_at futuro retorna 400._

**Phase 1 commit + merge.** Backend queda listo; UI vieja sigue funcionando igual (los 409 se muestran como error genérico — aceptable transicional).

---

## Phase 2 — Helpers compartidos y fixes chicos

- [ ] **T2.1** — `src/lib/time-entries/draft-storage.ts` con `readDraft`, `writeDraft`, `clearDraft`. SSR-safe. TTL 24h. Scope por userId. _DoD: unit tests pasan._
- [ ] **T2.2** — `tests/unit/draft-storage.test.ts`: round-trip, TTL expira, scope por user, no se rompe sin window. _DoD: `pnpm test:unit tests/unit/draft-storage.test.ts` pasa._
- [ ] **T2.3** — Nueva función `humanizeElapsed(seconds: number): string` en `src/lib/time-entries/format.ts`. Formato: < 60s → "<1 min", 1-59 min → "N min", 1-23h → "Nh M min", ≥ 24h → "N d H h". _DoD: `tests/unit/humanize-elapsed.test.ts` cubre edges._
- [ ] **T2.4** — Nueva función `getLocalDayISO(startedAt: string): string` en `src/lib/time-entries/week.ts`. Convierte ISO datetime a YYYY-MM-DD en zona `America/Argentina/Buenos_Aires`. _DoD: `tests/unit/local-day-iso.test.ts` cubre caso de UTC medianoche cayendo en el día previo de BA._
- [ ] **T2.5** — Fix overflow en `src/components/time-entries/searchable-selector.tsx`: línea 97 `className` del span → `"truncate flex-1 min-w-0 text-left"`. _DoD: ticket largo en el dialog trunca sin romper el popover (verificación visual)._
- [ ] **T2.6** — Rework `src/components/time-entries/time-entry-card.tsx`: siempre mostrar activity (o "Sin tarea") + project (línea caption) + ticket key (si hay) + description (si hay). _DoD: cards con combinaciones de campos cargados renderan los cuatro sin romper layout._

**Phase 2 commit + merge.** Tres mejoras visibles sin tocar lógica del timer.

---

## Phase 3 — Enable project edit

- [ ] **T3.1** — `<TimeEntryDialog>` línea 296: quitar `mode === "edit"` del `disabled`. _DoD: en edit mode el selector de proyecto está habilitado._
- [ ] **T3.2** — `onChange` del project selector: `setForm({...form, projectId: value, activityId: null, ticketId: null})`. _DoD: cambiar project en edit resetea los otros dos._
- [ ] **T3.3** — PATCH body del `submit`: incluir `project_id` cuando el value cambió respecto al initial. _DoD: PATCH con project_id llega al handler._
- [ ] **T3.4** — Draft persistence en `<TimeEntryDialog>`: `useEffect([open, initial])` lee draft primero (`time-entry-draft-create` o `time-entry-draft-edit-${id}`); `useEffect([form])` escribe draft; onSuccess borra. _DoD: cambiar de pestaña con form a medio llenar y volver → sigue llena._

**Phase 3 commit + merge.** Issues 1 + 7 (parcial) cerrados.

---

## Phase 4 — Running timer card

- [ ] **T4.1** — `src/components/time-entries/running-timer-card.tsx`: card con contador vivo, botón stop/discard, popover de edición in-flight sobre cada campo. _DoD: card renderiza; cambiar cualquier campo persiste via PATCH._
- [ ] **T4.2** — `src/app/(app)/my-time/page.tsx`: agregar `getMyActiveTimer()` al `Promise.all`. Pasar `activeTimer` a `<WeeklyGridView>`. _DoD: página sigue cargando sin regresión; `activeTimer` llega como prop._
- [ ] **T4.3** — `<WeeklyGridView>`: nueva prop `activeTimer`. Función local `getLocalDayISO` para decidir en qué columna va. Renderizar `<RunningTimerCard>` arriba de los `TimeEntryCard` del día que corresponde. _DoD: iniciar un timer → card aparece en la columna del día; editar started_at a otro día → al refresh se mueve de columna._

**Phase 4 commit + merge.** Issue 3 cerrado.

---

## Phase 5 — Play en cards + prefill TimerStartDialog

- [ ] **T5.1** — `<TimeEntryCard>`: botón `<PlayIcon>` entre edit y delete. Siempre visible (no condicionado a `canEdit`). Callback `onStartTimer?: (entry) => void`. _DoD: hover sobre card muestra 3 botones (edit, delete, play) y el play dispara el callback._
- [ ] **T5.2** — `<TimerStartDialog>`: nueva prop opcional `initialValues?: {projectId, activityId, ticketId}`. Si viene, pre-rellena el `useState` inicial. _DoD: pasar initialValues abre el dialog con esos campos elegidos._
- [ ] **T5.3** — `<WeeklyGridView>`: estado `timerStartInitialValues`. Pasar `onStartTimer={(entry) => { setTimerStartInitialValues({...}); setTimerStartOpen(true); }}` a cada card. Reset el initialValues al cerrar. _DoD: click play en una card abre el dialog con el project/activity/ticket de esa card._

**Phase 5 commit + merge.** Issue 4 cerrado.

---

## Phase 6 — Warn-before-stop en TimerStartDialog + draft

- [ ] **T6.1** — `<TimerStartDialog>`: manejar response 409 `reason: 'timer_active'`. Nuevo estado `activeTimerWarning: {timer, elapsed} | null`. _DoD: con un timer activo, el POST retorna 409 y la UI muestra el bloque informativo._
- [ ] **T6.2** — Bloque informativo con label + humanizeElapsed(elapsed) + dos botones ("Guardar y arrancar", "Descartar y arrancar"). Cada botón hace sus dos POSTs secuenciales y después cierra el dialog. _DoD: ambas vías llegan a arrancar el timer nuevo; el viejo queda guardado como entry o descartado._
- [ ] **T6.3** — Draft persistence en `<TimerStartDialog>` (key: `timer-start-draft`). Mismo patrón de T3.4. _DoD: form del dialog persiste al cambiar de pestaña._

**Phase 6 commit + merge.** Issues 2 + 7 cerrados.

---

## Phase 7 — Cierre

- [ ] **T7.1** — Actualizar `specs/features/README.md`: agregar fila `030`, actualizar sección de alcance.
- [ ] **T7.2** — Verificación manual post-deploy siguiendo "Verificación end-to-end" del plan file.
- [ ] **T7.3** — Si aparece deuda nueva durante la implementación, anotar en `docs/deuda-tecnica.md` + acá.

---

## Not in scope (follow-ups si aparecen)

- Botón "play" en las cards del detalle de ticket (`/tickets/[key]`), que también se beneficiarían.
- Agregar notas (description) al active_timer desde la pill del header (hoy solo via running card).
- Timer pausable.
- Múltiples timers simultáneos por user.
- Drop del RPC `stop_and_start_timer` (sin consumidores pero no estorba — fase 2 si no reaparece).
