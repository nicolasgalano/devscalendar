# Plan — Time tracker correcciones post-launch

- **ID:** 030-time-tracker-fixes
- **Spec:** `./spec.md`
- **Status:** draft

---

## 1. Resumen

Seis correcciones agrupadas que tocan la misma superficie. El bug crítico del cronómetro se resuelve con una capa doble (UI avisa antes de pisar + SQL capea minutes); el running card suma una vista nueva en la grilla con edición in-flight; el resto son fixes puntuales en componentes existentes + un helper de drafts compartido.

## 2. Arquitectura

### 2.1. SQL — migration 27

Archivo: `supabase/migrations/00000000000027_time_tracker_fixes.sql`

```sql
-- Fase 1 (aditiva): columna description en active_timers + stop_timer con cap.
alter table public.active_timers add column description text;

create or replace function public.stop_timer(p_user_id uuid) returns uuid ...
-- v_minutes := least(960, greatest(15, (elapsed/60/15)::int * 15));
-- insert ... description = v_timer.description (en vez de null forzado)
```

**Backward-compat verificado:** stop_timer actualizado con `v_timer.description` sigue devolviendo `null` para timers viejos sin description (la columna arranca `null` para todos). El cap no cambia el comportamiento salvo para timers con elapsed > 960 min, que hoy explotan.

### 2.2. Backend — handlers

**`src/lib/validation/time-entries.ts`:**
- `updateTimeEntrySchema`: agrega `project_id: z.string().uuid().optional()`.
- Nuevo `updateActiveTimerSchema`: `{ project_id?, ticket_id?, activity_id?, started_at?, description? }`. `started_at` como ISO 8601 datetime.

**`src/app/api/time-entries/[id]/route.ts`** (PATCH):
- Si `parsed.data.project_id` viene y es ≠ al actual, re-chequear contributor+ con `can_view_project` RPC (misma que usa start).
- Validar que ticket + activity (si vienen no-null) pertenecen al proyecto **final** (nuevo si cambió, viejo si no).
- Agregar `project_id` al update spread.

**`src/app/api/time-entries/timer/start/route.ts`:**
- Antes de llamar al RPC, hacer `supabase.from("active_timers").select("...").maybeSingle()`.
- Si hay fila, devolver `409 { reason: "timer_active", timer: {...ActiveTimer} }` sin tocar nada.
- Si no hay fila, usar RPC `stop_and_start_timer` como hoy — igual queda la misma transacción atómica para el caso feliz (aunque el `stop_timer` interno ya no stopeará nada porque arrancó verificando que no había timer previo).
  - **Alternativa simplista**: cambiar a `insert into active_timers` directo. Pero preservar `stop_and_start_timer` evita cambios en migraciones y mantiene la operación atómica. Mantengo el RPC.

**Nuevo: `src/app/api/time-entries/timer/route.ts`** (PATCH):
- Validar `updateActiveTimerSchema`.
- Leer el timer actual del user. Si no hay, 404 `reason: 'no_timer'`.
- Si cambia `project_id`: re-chequear `can_view_project` del nuevo. Si cambia project y vienen ticket_id/activity_id no-null, validarlos contra el proyecto nuevo. Si vienen null, OK.
- Si `started_at` viene, verificar que `new Date(started_at) < new Date()` (no futuro) y responder 400 `reason: 'future_start'` si no.
- `.update({...})` filtrado por `user_id = auth.uid()` (RLS garantiza aislamiento).
- Response: `{ ok: true, timer: {...updated ActiveTimer} }`.

### 2.3. Backend — `/my-time` page

`src/app/(app)/my-time/page.tsx`:
- Importar `getMyActiveTimer` desde `@/lib/time-entries/query` (ya existe).
- Sumar al `Promise.all` del fetch inicial. Pasar como `activeTimer` prop a `<WeeklyGridView>`.

### 2.4. Frontend — componentes nuevos

**`src/components/time-entries/running-timer-card.tsx`:**
Card similar a `<TimeEntryCard>` pero con:
- Contador vivo H:MM:SS que avanza cada segundo (patrón de `<TimerPill>`).
- Border de énfasis (`border-primary` o similar) + badge visual indicando "corriendo".
- Click en cada campo abre un popover de edición in-flight.
  - started_at → `<input type="time">` con submit onBlur.
  - project → `<SearchableSelector>` (misma lista que el dialog).
  - activity → `<Select>` con las del proyecto actual.
  - ticket → `<SearchableSelector>` clearable.
  - description → `<Textarea>`.
- Botones: Parar (POST stop → redirect a `/my-time?edit=<id>`), Descartar (POST discard).

**`src/lib/time-entries/draft-storage.ts`:**
Helper SSR-safe (no toca localStorage si no está disponible). API:
```ts
type DraftEnvelope<T> = { value: T; writtenAt: number };
const TTL_MS = 24 * 60 * 60 * 1000;

export function readDraft<T>(key: string, userId: string): T | null;
export function writeDraft<T>(key: string, userId: string, value: T): void;
export function clearDraft(key: string, userId: string): void;
```
Las keys se arman como `${baseKey}:${userId}` adentro para scope por usuario sin leak entre cuentas. Round-trip JSON. TTL se chequea al leer; expirado → `clearDraft` + return null.

### 2.5. Frontend — componentes modificados

**`<SearchableSelector>`** (overflow):
- Línea 97: `<span className="truncate text-left">` → `<span className="truncate flex-1 min-w-0 text-left">`. El `min-w-0 flex-1` es lo que habilita el truncate dentro del flex container.

**`<TimeEntryDialog>`**:
- Línea 296: `disabled={projects.length === 0}` (quitar el `mode === "edit"`).
- `onChange` del project: `setForm({ ...form, projectId: value, activityId: null, ticketId: null })`.
- PATCH body: incluir `project_id` también en edit mode.
- `useEffect([open, initial])`: leer draft al abrir (`readDraft('time-entry-draft', viewer.id)` para create, `readDraft(`time-entry-draft-edit-${initial.id}`, ...)` para edit). Si hay, usar el draft en vez de `initial`.
- En cada `setForm`, hacer `writeDraft(...)`. Debounce 300 ms vía `useEffect([form])`.
- En el handler de success del submit, `clearDraft(...)`.

**`<TimerStartDialog>`**:
- Nueva prop opcional `initialValues?: { projectId, activityId, ticketId }`. Si viene, el `useState` inicial usa esos valores (para el flujo "play").
- Mismo patrón de draft que el dialog manual, key: `timer-start-draft`.
- Nuevo estado `activeTimerWarning: { timer, elapsed } | null`. Cuando el submit devuelve 409 `reason: 'timer_active'`, llena este state y renderiza un bloque arriba del form con:
  - Label del timer activo + elapsed humanizado.
  - Botón "Guardar y arrancar" → POST `/timer/stop` → POST `/timer/start` con el payload actual.
  - Botón "Descartar y arrancar" → POST `/timer/discard` → POST `/timer/start` con el payload actual.
- Humanize elapsed: nuevo helper `humanizeElapsed(seconds)` en `format.ts`: "47 min", "3 h 20 min", "2 d 7 h", "17 d" (si > 10 días).

**`<TimeEntryCard>`**:
- Reemplazar el bloque de `{entry.activity?.name ?? <span italic>{entry.project.name}</span>}` por:
  ```tsx
  <p>{entry.activity?.name ?? "Sin tarea"}</p>
  <p className="caption text-muted-foreground">{entry.project.name}</p>
  ```
- El ticket key y notes quedan como están.
- Agregar `<PlayIcon>` entre los botones (siempre visible en hover, no condicionado a `canEdit`). Nueva prop `onStartTimer?: (entry: TimeEntryListItem) => void`.

**`<WeeklyGridView>`**:
- Nueva prop `activeTimer: ActiveTimer | null`.
- Nuevo estado `timerStartInitialValues: {projectId, activityId, ticketId} | null`. Cuando se abre con initial, se setea; onOpenChange = false lo limpia.
- Función `getLocalDayISO(startedAt: string): string` que convierte a BA zone y devuelve YYYY-MM-DD. Usa `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' })`.
- Antes del `.map(entry)` dentro de cada columna del día, si `activeTimer` existe y `getLocalDayISO(activeTimer.startedAt) === day`, renderizar `<RunningTimerCard activeTimer={activeTimer} projects={...} activitiesByProject={...} ticketsByProject={...} />`.
- Pasar `onStartTimer={handleStartTimer}` a cada `<TimeEntryCard>`.

## 3. Testing

Unit tests (los que corren local):

- `tests/unit/draft-storage.test.ts`: round-trip write/read, TTL expira, scope por userId, SSR-safe (no explota sin window).
- `tests/unit/humanize-elapsed.test.ts`: 60s → "1 min", 3600s → "1 h", 86400s → "1 d", edges.
- `tests/unit/local-day-iso.test.ts`: `getLocalDayISO` convierte correctamente para la zona de BA (`-03:00`). Caso donde `started_at = 2026-11-02T02:30:00Z` → `2026-11-01` (BA está en 23:30 del día anterior).

Smoke/integration/e2e van vía CI (ver `docs/testing.md`).

Verificación manual (post-deploy, en el sitio con `runId`):
- Mismos pasos de la sección "Verificación end-to-end" en `/Users/nicolasgalano/.claude/plans/bubbly-riding-bee.md`.

## 4. Orden de implementación

Phases independientemente mergeables (`016` y `027` siguen el mismo patrón).

**Phase 1** — SQL + validation + handlers (migration 27 aplicable sin que el código viejo rompa):
- Migration 27.
- `updateTimeEntrySchema` + `updateActiveTimerSchema`.
- PATCH `/time-entries/[id]` acepta `project_id`.
- POST `/timer/start` devuelve 409 si hay timer activo.
- PATCH `/time-entries/timer` nuevo.
- **Deploy intermedio ok**: el frontend viejo todavía no manda `project_id` en PATCH ni atrapa el 409 del start, pero sigue funcionando como antes (los endpoints son retrocompatibles salvo por la nueva señal 409 que el frontend viejo mostraría como error genérico).

**Phase 2** — Helpers compartidos y fixes chicos:
- `draft-storage.ts` + `humanize-elapsed` + `getLocalDayISO`.
- Fix overflow `<SearchableSelector>`.
- Rework `<TimeEntryCard>` para mostrar siempre project + activity + ticket + notes.

**Phase 3** — Enable project edit:
- `<TimeEntryDialog>`: habilitar project en edit + clear de ticket/activity al cambiar + PATCH con `project_id`.
- Draft persistence en `<TimeEntryDialog>` (reutiliza helper de Phase 2).

**Phase 4** — Running timer card:
- `<RunningTimerCard>` nuevo.
- Load `activeTimer` en `/my-time` page.
- Integración en `<WeeklyGridView>`.

**Phase 5** — Play en cards + prefill `<TimerStartDialog>`:
- `onStartTimer` callback en `<TimeEntryCard>` + prop en `<WeeklyGridView>`.
- `initialValues` en `<TimerStartDialog>`.

**Phase 6** — Warn-before-stop en start + draft en `<TimerStartDialog>`:
- Handle 409 `reason: 'timer_active'` con bloque informativo + 2 acciones.
- Draft persistence en `<TimerStartDialog>`.

**Phase 7** — Cierre:
- Actualizar `specs/features/README.md`.
- Nota en `CLAUDE.md` si corresponde (no debería hacer falta — nada cambia la mental model mayor de 016/027).

Las phases 1-6 pueden mergearse secuencial y mantener `develop` + `main` siempre deployable. El valor incremental sube linealmente.

## 5. Archivos impactados

**Nuevos:**
- `supabase/migrations/00000000000027_time_tracker_fixes.sql`
- `src/app/api/time-entries/timer/route.ts`
- `src/components/time-entries/running-timer-card.tsx`
- `src/lib/time-entries/draft-storage.ts`
- `tests/unit/draft-storage.test.ts`
- `tests/unit/humanize-elapsed.test.ts`
- `tests/unit/local-day-iso.test.ts`

**Modificados:**
- `src/lib/validation/time-entries.ts`
- `src/app/api/time-entries/[id]/route.ts`
- `src/app/api/time-entries/timer/start/route.ts`
- `src/app/(app)/my-time/page.tsx`
- `src/components/time-entries/time-entry-dialog.tsx`
- `src/components/time-entries/timer-start-dialog.tsx`
- `src/components/time-entries/time-entry-card.tsx`
- `src/components/time-entries/weekly-grid-view.tsx`
- `src/components/time-entries/searchable-selector.tsx`
- `src/lib/time-entries/format.ts` (nuevo `humanizeElapsed`)
- `specs/features/README.md`

**Sin tocar:**
- `src/components/timer-pill.tsx` — intacto; el pill sigue siendo el acceso global.
- RPC `stop_and_start_timer` — queda vivo (unused interno pero el handler lo invoca aún).

## 6. Rollback

Migration 27 es aditiva pura. Rollback = re-deploy del código anterior; la columna `description` sobra pero no estorba (todos los sites del código viejo pasan `null` al insert). El cap `least(960, ...)` también es neutro para el flujo normal (todos los timers razonables son < 16 h); solo salva el caso edge.
