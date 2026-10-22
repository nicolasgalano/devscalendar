# Tasks — Project capacity planning

- **ID:** 029-project-capacity-planning
- **Plan reference:** `./plan.md`
- **Status:** todo

Task format: `[ ]` open, `[x]` done, `[~]` in progress, `[!]` blocked. Phases are independently mergeable and deployable.

---

## Phase 1 — Schema + API (silencioso)

### 1a. Base de datos

- [ ] **T1.1** — Create migration `supabase/migrations/00000000000026_capacity_estimates.sql` with: table `capacity_estimates` + two indexes + RLS SELECT policy via `can_view_project(project_id)` + grant SELECT to authenticated + the two RPCs `upsert_capacity_estimate` and `delete_capacity_estimate` with their revoke/grant. All per plan §3. _DoD: migration applies cleanly on a scratch DB; `\d capacity_estimates` shows unique constraint; `\df upsert_capacity_estimate` shows signature; INSERT grant is **not** on authenticated._
- [ ] **T1.2** — Apply migration + regen types: `pnpm db:push` then `pnpm db:types`. Commit the regenerated `src/types/database.ts` with T1.1. _Requires explicit user confirmation (shared DB). DoD: `supabase.rpc("upsert_capacity_estimate", {...})` typechecks with the signature from plan §3._

### 1b. API

- [ ] **T1.3** — Create `src/lib/validation/capacity-estimates.ts` with `upsertCapacityEstimateSchema` per plan §4. _DoD: schema parses `{ projectId, devId, date, hours }` valid; rejects hours=0, hours=25, hours=-1, date="2026/10/21", projectId="not-a-uuid"._
- [ ] **T1.4** — Create POST handler `src/app/api/capacity-estimates/route.ts` per plan §4. Guard `requireProjectMembership(parsed.projectId, "pm")`. Error map: DC004→400, DC011→400, DC012→400, 42501→403, else→500. _DoD: handler compiles; follows the pattern of 028's `/api/projects/[id]/active/route.ts`._
- [ ] **T1.5** — Create DELETE handler `src/app/api/capacity-estimates/[id]/route.ts` per plan §4. **Sin guard de ruta** — autoriza la RPC. Error map: DC010→404, 42501→403, else→500. _DoD: handler compiles; DELETE calls `rpc.delete_capacity_estimate({ p_id: id })` directly._

### 1c. Tests

- [ ] **T1.6** — Integration tests `tests/integration/capacity-estimates.test.ts` per plan §7:
  - SELECT: viewer OK, no-miembro no lee, admin OK (3 asserts)
  - upsert admin: crea + segunda llamada actualiza (unique no rompe) (2 asserts)
  - upsert PM primario: propio OK, ajeno 42501 (2 asserts)
  - upsert contributor: 42501 (1 assert)
  - upsert PM primario con profile desactivado: 42501 (1 assert)
  - upsert sobre proyecto desactivado: DC004 (1 assert)
  - upsert hours inválidas: 3 casos → DC011 (1 assert con 3 sub-cases)
  - upsert dev no-miembro: DC012; PM primario sin fila en members: OK (2 asserts)
  - delete: admin OK, PM primario OK, PM ajeno 42501, contributor 42501, id inexistente DC010, proyecto desactivado delete sigue (6 asserts)

  Todas las aserciones leen la fila de vuelta via `adminClient()`. _DoD: `pnpm test:integration tests/integration/capacity-estimates.test.ts` pasa en CI._

- [ ] **T1.7** — Unit test `tests/unit/capacity-estimates-validation.test.ts` para el Zod schema (válidos + inválidos). _DoD: `pnpm test:unit` pasa._

**Phase 1 commit + merge + deploy.** Migration en prod, endpoint vivo pero sin consumer. Cero cambio visible para usuarios.

---

## Phase 2 — UI de la grilla

### 2a. Helpers puros

- [ ] **T2.1** — Create `src/lib/planning/constants.ts` con las constantes del plan §5 (`PLANNING_CELL_WIDTH`, `PLANNING_LABEL_WIDTH`, `PLANNING_ROW_HEIGHT`, `PLANNING_WEEK_SIZE`, `PLANNING_VISIBLE_WEEKS`, `PLANNING_VISIBLE_DAYS`). Refactor `src/components/calendar/planning-view.tsx` para importar las primeras tres de ahí en vez de declararlas locales. _DoD: `/calendar?view=planning` renderiza visualmente idéntico (verificación manual rápida); typecheck + lint clean._
- [ ] **T2.2** — Create `src/lib/planning/range.ts` con `getCapacityWeekBounds(today, offsetWeeks)` que devuelve `{ days: string[], weekStart: string }` — 4 semanas con hoy en la cuarta fila cuando `offsetWeeks=0`. Pure function. _DoD: unit test en T2.9._
- [ ] **T2.3** — Create `src/lib/planning/totals.ts` con `sumByDay(estimates)` y `sumByDevWeek(estimates, days)`. Pure. _DoD: unit test en T2.9._
- [ ] **T2.4** — Create `src/lib/planning/url.ts` con `parseCapacityUrl(sp)` y `capacityHref(current, patch)`. Parser nunca tira; serializer omite defaults. _DoD: unit test en T2.9._

### 2b. Queries server-side

- [ ] **T2.5** — Create `src/lib/planning/capacity.ts` con `getProjectCapacityEstimates(projectId, dateFrom, dateTo)` y `getPlanningDevs(projectId, pmId, estimates)` por plan §5. _DoD: funciones typechequean, no se testean sueltas (requieren DB)._

### 2c. Páginas

- [ ] **T2.6** — Create `src/app/(app)/planning/page.tsx` + `src/app/(app)/planning/loading.tsx`. Server component resuelve profile + visible projects (**activos únicamente** — R-9) + parsea URL + si hay projectKey válido, resuelve project + devs + estimates + days. Pasa todo al `<CapacityPlanningView>`. Si no hay projectKey, pasa `project={null}` para mostrar EmptyState. _DoD: ruta accesible; sin projectKey muestra EmptyState; con projectKey inválido fallback a EmptyState._

### 2d. Componente de grilla

- [ ] **T2.7** — Create `src/components/planning/capacity-planning-view.tsx` (client). Props: `projects`, `project`, `devs`, `estimates`, `days`, `canEdit`, `currentUserId`, `urlState`. Renderiza: toolbar (selector proyecto + navegación semanal + "Hoy") + grilla CSS con sticky header. Celdas no-laborables con fondo gris. Totales por día al pie + subtotales por semana al margen de cada bloque de 7 columnas. Imports de `src/lib/planning/constants.ts`. _DoD: navegación de semanas funciona, selector cambia URL, totales se actualizan en vivo._
- [ ] **T2.8** — Create `src/components/planning/capacity-cell.tsx` + `src/components/planning/capacity-popover.tsx`. Cell: muestra valor sobre fondo primary/10, click abre popover si `canEdit`. Popover: input number `step=0.25 min=0.25 max=24` autofocus con valor seleccionado, botón Guardar (POST), botón Borrar visible solo si hay estimación existente (DELETE). Esc cancela. Errores inline. En 200 → `router.refresh()` + cierra popover. _DoD: happy path crea + edita + borra una estimación._

### 2e. Tests unit

- [ ] **T2.9** — Unit tests para T2.2–T2.4:
  - `tests/unit/capacity-range.test.ts`: today=2026-10-21 (miércoles) → `days[21]` es "2026-10-21" (cuarta fila L a V, hoy miércoles de la cuarta semana); offset=1 adelanta una semana; offset=-1 atrasa; `days.length === 28`.
  - `tests/unit/capacity-totals.test.ts`: `sumByDay([])` → `Map(0)`; `sumByDay([{devId,date,hours}])` → `Map(1)`; dos estimaciones mismo día suman; `sumByDevWeek` dividido correctamente en buckets de 7.
  - `tests/unit/capacity-url.test.ts`: round-trip; `projectKey` inválido → null; defaults no se escriben; parse tolerante.

  _DoD: `pnpm test:unit` pasa los tres nuevos files._

**Phase 2 commit + merge + deploy.** `/planning` funciona vía URL manual. Falta nav para que sea descubrible.

---

## Phase 3 — Nav + cierre

- [ ] **T3.1** — Agregar "Planificación" al nav lateral del `AppShell`. Ícono `CalendarRange` (lucide-react). Href `/planning`. Posición entre "Calendario" y "Proyectos". **Verificar nombre exacto del componente del nav al implementar** (probablemente `src/components/app-shell/sidebar.tsx` o similar). _DoD: ítem aparece y navega; marca activa cuando la URL está en `/planning*`._
- [ ] **T3.2** — Verificación manual post-deploy (plan §7 "Manual"):
  - admin: cargar + editar + borrar estimaciones en cualquier proyecto.
  - PM primario de X: solo X en selector; editar OK en X; con `?project=` ajeno a mano la grilla no renderiza (sin permiso al cargar el proyecto, cae a EmptyState).
  - contributor: ve el proyecto en el selector; grilla read-only (click en celda no abre popover).
  - developer sin membresía: no ve el proyecto en el selector.
  - Navegación semanas + Hoy + compartir URL.
  - Dev dado de baja con estimaciones: aparece al pie, read-only (si no hay dev así, crearlo de prueba y verificar).

  _DoD: usuario confirma._

- [ ] **T3.3** — Update `specs/features/README.md` — marcar `029` como `code done (deployed YYYY-MM-DD)`.
- [ ] **T3.4** — Nota corta en `CLAUDE.md` (una o dos líneas bajo la sección existente de proyectos o planning): "La planificación de capacidad vive en `/planning` sobre `capacity_estimates` (tabla nueva de 029). `/calendar?view=planning` sigue siendo sobre bookings — dos ejes, no colisionan."
- [ ] **T3.5** — Confirmar que `docs/deuda-tecnica.md` no suma entradas nuevas (a menos que algo del refactor de constantes de T2.1 haya dejado un workaround).

---

## Not in scope (follow-ups, if they appear)

- Vista cross-proyecto (`/planning` sin proyecto seleccionado muestra todas las estimaciones del dev X en el mes).
- Alertas de sobrecarga sumando capacity + bookings del mismo dev-día.
- Reporte "plan vs real" en `/reports/*` cruzando `capacity_estimates` con `time_entries`.
- Atajo "repetir en todos los días hábiles de la semana" en el popover.
- Audit log de cambios de estimaciones (trigger análogo al de `projects_log_priority_change`).
- Celda con color por intensidad (ej. más oscuro cuando se acerca al tope del dev).
- Keyboard navigation en la grilla (flechas para moverse entre celdas).
- Export de la grilla a CSV / XLSX (patrón de `021`).
- Multi-select de celdas para "borrar en lote".
