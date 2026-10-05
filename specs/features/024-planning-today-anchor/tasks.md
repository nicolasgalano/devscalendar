# Tasks — Planning: la semana de hoy queda como la última de las 4 visibles

- **ID:** 024-planning-today-anchor
- **Plan reference:** `./plan.md`
- **Spec reference:** `./spec.md`
- **Estado:** draft

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

Feature de una tarde. Una sola phase con 6 tareas.

---

## Phase 1 — Cambio y verificación

- [ ] **T1.1** — `src/lib/calendar/range.ts`: extender la firma de `viewBounds` con `opts?: { today?: string }` y aplicar la regla en `case "planning"` (§2.1 del plan). Actualizar el JSDoc del case explicando el "por qué" con referencia a Regla 024.
  - _DoD:_ `pnpm typecheck` verde. Sin cambios de comportamiento cuando `opts` no se pasa.

- [ ] **T1.2** — `src/lib/calendar/range.ts`: extender `resolveRange` con `opts?: { today?: string }` que forwardea a `viewBounds` (§2.2 del plan).
  - _DoD:_ los tests existentes de `resolveRange` (líneas 21-50 de `range.test.ts`) siguen pasando sin modificaciones.

- [ ] **T1.3** — `src/app/(app)/calendar/page.tsx`: actualizar los 3 call sites para pasar `{ today }` (§3 del plan):
  - Línea 103: `resolveRange(params.view, params.date, TIMEZONE, { today })`.
  - Línea 211: `viewBounds("planning", params.date, { today })`.
  - Línea 239: `viewBounds(view, params.date, { today })`.
  - _DoD:_ el server component tipa sin errores; abrir `/calendar?view=planning` en dev muestra la grilla con hoy como 4ª fila.

- [ ] **T1.4** — `tests/unit/range.test.ts`: sumar el `describe("viewBounds(planning) with today anchor", ...)` con los 5 casos del §4.1 del plan:
  - `date !== today` mantiene ancla clásico.
  - `date === today` (miércoles) desplaza 3 semanas.
  - `date === today` (lunes) desplaza 3 semanas, hoy queda como primer día de la 4ª fila.
  - `date === today` (domingo) desplaza 3 semanas, hoy queda como último día de la 4ª fila.
  - Day/Month/Year ignoran `opts.today`.
  - _DoD:_ `pnpm test:unit` verde con los 5 casos nuevos.

- [ ] **T1.5** — Verificación local en el navegador (`pnpm dev`):
  - `/calendar?view=planning` → veo 3 semanas pasadas + esta semana (esta como 4ª fila).
  - Clickeo ▶ → salto a 4 semanas adelante (comportamiento clásico).
  - Clickeo ◀ desde "hoy en la última fila" → salto 4 semanas atrás.
  - Clickeo "Hoy" desde una fecha lejana → vuelvo al layout de 3 pasadas + hoy.
  - `/calendar?view=planning&date=2026-11-05` (fecha ≠ hoy) → 4 semanas ancladas al lunes de esa fecha (sin regla).
  - Day/Month/Year: "Hoy" me lleva a hoy tal como antes.
  - _DoD:_ los 6 puntos check-oks.

- [ ] **T1.6** — Cierre docs:
  - `specs/features/README.md`: fila 024 → `done (deployed YYYY-MM-DD)`.
  - Actualizar el párrafo de alcance de 024 con la fecha del deploy y el estado final.
  - `CLAUDE.md`: **no** se toca (§7.2 del plan — el JSDoc del case "planning" en `range.ts` cuenta el "por qué" en el lugar que importa).

- [ ] **T1.7** — Merge `feature/024-planning-today-anchor` → `develop`. Después del OK del user, merge `develop` → `main` (dispara deploy).

---

## Blocked / follow-ups

- [ ] **F1 — Highlight visual explícito de "esta semana" en la grilla.** Fondo tenue o border en la 4ª fila cuando aplica la regla. Requiere que `<PlanningView>` reciba `todayRowIndex: number | null`. Si al usar la feature aparece la confusión R-1 de la spec ("por qué arranca 3 semanas atrás"), sumar.

- [ ] **F2 — Preferencia por-usuario del anclaje.** `profiles.planning_anchor text default 'today-last'` con opciones `'today-first' | 'today-middle' | 'today-last'`. Aditivo, cuando aparezca el pedido.

- [ ] **F3 — Cambio del ancho de la ventana.** Convertir el `28` de `range.ts` en constante `PLANNING_WINDOW_DAYS` y recalcular el offset como `PLANNING_WINDOW_DAYS - 7`. Feature aparte.

- [ ] **F4 — Botón "Ir a esta semana" separado del "Hoy"** en vistas Day/Month/Year. Sin pedido activo.
