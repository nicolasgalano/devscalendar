# Tasks — PMs fuera del calendario por default

- **ID:** 014-hide-pms-in-calendar
- **Plan reference:** `./plan.md`
- **Status:** done — 2026-09-10, verificación visual del usuario aprobada.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

> **Antes de escribir una línea, leer `plan.md` §3 y §4.** La regla de "PM puro" tiene que salir de un solo lugar (`isPmOnly`) y el filtro de query se salta cuando hay `devId` explícito. Si eso se rompe, se rompe AC-3.1 y aparecen bugs de "seleccioné a Brenda y no veo nada".

---

## Phase 1 — Helper y validación

- [x] **T1.1** — `isPmOnly(roles)` en `src/lib/auth/roles.ts`. Devuelve `true` si `roles` incluye `pm` y **no** incluye `developer`. _DoD: unit test con los cuatro casos: `[]`, `['pm']`, `['pm','developer']`, `['developer']`; y `null`/`undefined`._
- [x] **T1.2** — Extender `CalendarFilters` con `includePms: boolean` en `src/lib/validation/calendar.ts`. Extender `parseCalendarParams` para leer `raw.includePms`: `"1"` → `true`, cualquier otra cosa (incluida ausencia) → `false`. _DoD: unit test que parsea `?includePms=1`, `?includePms=0`, `?includePms=asdf` y sin param, y que `hasActiveFilters({...defaults, includePms: true})` devuelve `true`._
- [x] **T1.3** — Extender `calendarHref` y `clearFiltersHref` en `src/lib/calendar/url.ts`: escribir `includePms=1` solo cuando `true`; `clearFiltersHref` vuelve a `false`. _DoD: unit test de round-trip (params → URL → params) para `true` y `false`; el default `false` no aparece en la URL._

## Phase 2 — Query

- [x] **T2.1** — `getPmOnlyDevIds(supabase)` en `src/lib/calendar/query.ts`, envuelto en `cache()`. Query: `profiles.select("id, roles").contains("roles", ["pm"]).eq("active", true)`, después `.filter(isPmOnly).map(p => p.id)` en JS. _DoD: smoke test que verifica que un PM puro aparece en la lista y un `{pm, developer}` no (ver `tests/smoke/` para el patrón)._
- [x] **T2.2** — Aplicar el filtro en `bookingsQuery` de `src/lib/calendar/query.ts` (`plan.md` §4). La regla: `if (!filters.includePms && !filters.devId && pmOnlyIds.length > 0) query.not("dev_id", "in", "(${ids.join(',')})")`. _DoD: T4.1._
- [x] **T2.3** — Mismo tratamiento en `getDevDayLoad` (`src/lib/calendar/query.ts`). Reusar `getPmOnlyDevIds` — el `cache()` lo deduplica dentro del request. _DoD: la sobrecarga de planning no cuenta las horas de un PM puro (T4.2)._

## Phase 3 — UI

- [x] **T3.1** — Toggle "Incluir PMs" en `src/components/calendar/calendar-filters.tsx`, al lado del `<Select>` de dev. El `onCheckedChange` navega a `calendarHref(current, { filters: { includePms: value } })`. _DoD: click sobre el toggle actualiza la URL (aparece o desaparece `?includePms=1`)._
- [x] **T3.2** — Etiqueta/badge cuando `filters.devId` apunta a un PM puro y `filters.includePms=false` (spec AC-3.2). Detalle visual: reusar el badge de shadcn ya presente en el proyecto (ver `DESIGN.md` §7), texto "PM". El componente necesita saber quiénes son PMs — inyectar `pmOnlyIds` desde la page como prop del panel de filtros. _DoD: seleccionar un PM en la URL muestra el badge; seleccionar un dev normal no lo muestra._
- [x] **T3.3** — Verificar que el dropdown de devs se filtra por gravedad (facets se derivan de bookings ya filtrados, `facets.ts:deriveFacets`). Un usuario nuevo abre `/calendar` y no ve a los PMs en el dropdown. **No requiere código nuevo si §2 quedó bien** — este paso es una verificación en el navegador. _DoD: abrir `/calendar` sin params en el browser, expandir el dropdown de dev, confirmar que Brenda/Lucía/Pedro no aparecen; togglear "Incluir PMs" y confirmar que aparecen._

## Phase 4 — Tests

- [x] **T4.1** — Smoke test en `tests/smoke/` (patrón de `bookings-*.test.ts` existente): con dos bookings —uno de un dev, uno de un PM puro— la query devuelve solo el del dev cuando `includePms=false`, y ambos cuando `includePms=true`. Cubre AC-1.1 y AC-2.2. Este va como smoke porque toca la construcción real del `.not("dev_id","in",...)` y ese es el tipo de filtro que un mock no valida (ver CLAUDE.md §Tests).
- [x] **T4.2** — Smoke test para `getDevDayLoad`: la sobrecarga no incluye horas de PM puros con `includePms=false`. Cubre AC-1.3.
- [x] **T4.3** — Smoke test de AC-3.1: con `filters.devId = <PM-id>` y `includePms=false`, la query devuelve las reservas de ese PM. **Este es el test que evita el bug de "seleccioné a Brenda y no veo nada".**
- [x] **T4.4** — Unit tests de `isPmOnly`, `parseCalendarParams` y `calendarHref` para `includePms` (mencionados en cada task).

## Phase 5 — Cierre

- [x] **T5.1** — Actualizar `specs/features/README.md`: agregar `014-hide-pms-in-calendar` a la lista, estado done, con una línea que explique la decisión de default y el toggle. Sin ADR — no hay decisión no obvia que amerite uno.
- [x] **T5.2** — Actualizar `CLAUDE.md` en la sección "Estado de features": agregar 014 con la misma línea que arriba. Y mencionar en "Roles y `active`" que existe `isPmOnly()` para el caso "PM puro" — con una línea, no un párrafo.
- [x] **T5.3** — Verificación visual del usuario en el navegador. La feature es chica pero cambia el default de una vista central; que la vea corriendo antes de darla por cerrada.
