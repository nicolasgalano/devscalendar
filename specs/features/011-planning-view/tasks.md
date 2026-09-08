# Tasks — Planning view

- **ID:** 011-planning-view
- **Plan reference:** `./plan.md`
- **Status:** in progress.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

> **Antes de escribir una línea, leer `plan.md` §5.** La sobrecarga se calcula con una **segunda query sin filtros de entidad**, no reusando el array filtrado por la UI: si se mezcla, un PM que filtra por su cliente ve a los devs "libres" porque el resto de sus proyectos está fuera del array. Eso es justo el bug que la feature previene.

> **Y leer `plan.md` §3.2.** Nadie tiene ganas de agregar una tabla `project_devs` "aprovechando" esta feature. Es un cambio de producto (habría que asignar dev al proyecto antes de reservar) y no un facilitador de esta vista. Queda anotado como Q-P4 y sale así.

---

## Phase 0 — Antes de empezar

- [x] **T0.1** — **Confirmar Q-P1 (¿`>8h` estricto o `≥8h`?).** El default aplicado es **`>8h` estricto**: la jornada completa 09–17 son 8 h netas y no es sobrecarga; una hora extra sí lo es. No bloquea la implementación —el comparador está en un solo lugar (`plan.md` §5)— pero define el umbral visual en `DESIGN.md`. Sale con el default.
- [x] **T0.2** — **Confirmar Q-P4 (¿filas para devs sin reservas en la ventana?).** El default es **no**: la relación "dev asignado a proyecto" no existe en el modelo (`plan.md` §3.2). Habilitarlo exige una tabla nueva y cambia el flow de alta. Sale con el default; si el cliente lo pide, se reabre.
- [x] **T0.3** — **Q-P2 (cross-midnight)** resuelto por `plan.md` §4.3: se divide por día calendario en zona local. Vive en `splitBookingByDay()` y lo cubren tests unitarios (T3.1).
- [x] **T0.4** — **Q-P3 (proyectos recurrentes)** fuera del MVP. El modelo no tiene `is_recurring`; sumarlo es una feature de producto. Sale así.

## Phase 1 — Datos y helpers puros

- [ ] **T1.1** — `mondayOf(isoDate)` en `src/lib/calendar/range.ts`, más las tres ramas nuevas de `viewBounds` / `shiftDate` / `resolveRange` para `"planning"` (`plan.md` §8.2). El `date` en la URL **no se normaliza al lunes** para poder cargar `?view=planning&date=2026-05-14` (miércoles) y ver la semana que lo contiene. _DoD: unit tests de `mondayOf` con lunes, domingo, cambio de mes y cambio de año — la trampa histórica de `getUTCDay` sobre un `Date` en zona local (`plan.md` R-3)._
- [ ] **T1.2** — `"planning"` en `calendarViewSchema` (`src/lib/validation/calendar.ts`). `DEFAULT_VIEW` sigue siendo `month`. _DoD: `parseCalendarParams` la acepta y `parseCalendarParams(?view=planning)` la devuelve; una vista basura sigue cayendo al default._
- [ ] **T1.3** — `src/lib/calendar/planning.ts`: **funciones puras**.
  - `splitBookingByDay(booking, days, tz)`: distribuye los minutos por día calendario **en zona local**, no en UTC (Q-P2, `plan.md` §4.3). Reusa `zonedToInstant` y `minutesOfDay`.
  - `buildPlanningMatrix(bookings, days, tz)`: filas ordenadas alfabéticamente por `client → project → dev`. Una fila por combinación con al menos una reserva `approved | pending | displaced` en la ventana. `hoursApproved + hoursPending` se suma, `displaced` **no aporta horas pero sí aparece en `bookingIds`** (spec §5, `plan.md` §4.2).
  - `computeDevDayLoad(rows, days, tz)`: `Map<${devId}::${isoDate}, hours>`. Sin filtros. La aritmética también pasa por `splitBookingByDay` — la definición de "día" es la misma que para la matriz.
  - `describeOverload(devId, isoDate, rows, projects)`: texto del tooltip de AC-2.2, con el nombre de cada proyecto y las horas que aporta. **Sin acá, R-1 no tiene mitigación.**
  - _DoD: T3.1._
- [ ] **T1.4** — `getDevDayLoad(supabase, range)` en `src/lib/calendar/query.ts` (`plan.md` §5): select mínimo (`dev_id, starts_at, ends_at`), `status in ('approved','pending')`, **sin filtros de entidad**. Reusa la misma silueta de `getDayLoad` pero sin pasar por `bookingsQuery` para dejar explícito que ningún filtro de UI la toca. _DoD: T3.2._

## Phase 2 — UI

- [ ] **T2.1** — `src/components/calendar/planning-view.tsx` (server component): la grilla completa (`plan.md` §7.1).
  - Un solo `grid-template-columns` para cabecera y cuerpo (`DESIGN.md §5`), como la vista día.
  - Dos filas de cabecera: semana arriba (`Sem 15 (6-12/4)`), día abajo (`L M Mi J V S D` con fecha). `position: sticky; top: 0` sobre un contenedor `overflow-auto`.
  - Columna izquierda de labels con `position: sticky; left: 0`.
  - Columnas de weekends y feriados con fondo `--muted`, no interactivas — usa `isWorkday()` (`plan.md` §7.1). Contra la tentación de esconderlas: la vista Mes las muestra igual y esa consistencia importa (`plan.md` §11).
  - Filas jerárquicas: cliente `text-body` peso 500, proyecto peso 500 con indent, dev con avatar de `DESIGN.md §8`. **Solo dos pesos** (`DESIGN.md §4`).
  - _DoD: revisión visual + T4.1._
- [ ] **T2.2** — `src/components/calendar/planning-cell.tsx` (client component): celda con popover.
  - Cuatro estados visuales de `plan.md` §7.2: vacía laborable, vacía no laborable, con horas sin pending, con horas con pending (borde punteado 1px `--secondary-foreground` interno). El número siempre en `.font-data`.
  - Sobrecarga (`plan.md` §7.3): outline 1.5px `--danger` hacia adentro cuando `hoursOverload > 8`. El tooltip con `describeOverload()` es **AC-2.2 y no es opcional** — sin él el número deja de ser explicable.
  - Popover al clickear celda con horas (`plan.md` §7.4): franja horaria, `BookingStatusTag`, badge de prioridad si corresponde, link a la vista día con `calendarHref(params, { view: "day", date })` para preservar filtros. Reusa `PopoverContent`, `PopoverHeader`, `PopoverTitle`.
  - Celda vacía en día laborable: **no hace nada al click** (AC-4.2). Sin `cursor: pointer`, para que el affordance sea correcto.
  - _DoD: T4.1._

## Phase 3 — Wiring

- [ ] **T3.1** — `renderPlanning()` en `src/app/(app)/calendar/page.tsx` como cuarta rama del switch de vista. `Promise.all` con `getBookingsInRange` (misma que la vista día — **no una `getPlanningBookings()` paralela**, `plan.md` §6) y `getDevDayLoad`. Reusa `emptyOrNoResults()` con `describeFilters()` sin cambios. _DoD: T4.1._
- [ ] **T3.2** — Sumar `{ value: "planning", label: "Planificación" }` al array `VIEWS` de `src/components/calendar/calendar-toolbar.tsx`. Los botones anterior / siguiente / hoy funcionan solos gracias a `shiftDate("planning", ...)`. **La agrupación (`GROUPS`) no aparece en planning** — es cliente > proyecto > dev fijo, no un eje conmutable. Extender el `params.view === "day"` a la nueva vista sería mostrar un control que no hace nada.

## Phase 4 — Tests

- [ ] **T4.1** — **Unit `plan.md` §12**:
  - `buildPlanningMatrix`: fixtures con `approved` / `pending` / `displaced`, verifica orden alfabético, `hasPending`, exclusión de horas de `displaced` (sí en `bookingIds`, no en horas).
  - `splitBookingByDay`: casos `22:00–02:00`, `23:00–08:00`, tres días. **Y un caso DST** — hoy AR no aplica, pero el código no puede depender de eso (`plan.md` R-3 análogo).
  - `computeDevDayLoad`: `8h` exacto no marca, `9h` marca, `4h + 5h` en dos proyectos también marca. La aritmética debe empatar con la de la matriz cuando el filtro no oculta nada.
  - `mondayOf`: lunes, domingo, cambio de mes, cambio de año, con parseo UTC no shift local (R-3 del plan).
  - _DoD: `pnpm test:unit` en verde, corren local sin Supabase._
- [ ] **T4.2** — **Integración (CI)**: que `getDevDayLoad` y `getBookingsInRange` sin filtros devuelvan los mismos ids en la ventana (modulo columnas). Que un dev vea sumar reservas de un cliente ajeno cuando es admin (por RLS de Q-5).
- [ ] **T4.3** — **E2E (CI)**: abrir `/calendar?view=planning`, ver 4 semanas ancladas al lunes; filtrar por cliente y verificar que el **tooltip de sobrecarga sigue nombrando el proyecto oculto** (esta es la aserción crítica de R-1); click en una celda con horas abre el popover con reservas concretas y el link va al día correcto con los filtros preservados. Un feriado en la ventana se ve muted y no interactivo.

## Phase 5 — Docs & handoff

- [ ] **T5.1** — `CLAUDE.md`: sumar `011` al listado de estado con una línea corta, y refrescar la "Próxima" si aplica.
- [ ] **T5.2** — `DESIGN.md` §14: entrada de 011 con lo aplicado — los cuatro estados visuales de la celda, la marca de sobrecarga, y la explícita reutilización del tratamiento de días no laborables.
- [ ] **T5.3** — `specs/features/README.md`: `011` a `done`.
- [ ] **T5.4** — Revisión visual en ambos temas, a 1280 / 1440 / <1024px. Necesita ojos humanos.

---

## Blocked / follow-ups

- [ ] **F1** — **Agrupación colapsable por cliente** (`plan.md` §10 R-2). Los seis filtros ya acotan filas; esto es la mitigación si aparece antes de tiempo el caso de 40+ filas. Estado en URL como `collapsed=clientA,clientB`.
- [ ] **F2** — **Subtotales agregados** por proyecto o cliente en las filas de cabecera. Fuera de spec porque el uso real dirá si hace falta. Sumar solo si aparece la necesidad.
- [ ] **F3** — **Vista de disponibilidad** independiente ("quién está libre esta semana"). La señal de ociosidad (celdas vacías visibles) cubre parcialmente el caso; una vista dedicada es Fase 2.
- [ ] **F4** — **Export a CSV / impresión.** Fuera del MVP.
- [ ] **F5** — **Marcar proyectos recurrentes** (Q-P3): agrega `is_recurring` al modelo y un tratamiento visual. Fase 2 si el cliente lo pide.
