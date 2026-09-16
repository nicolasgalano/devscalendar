# Tasks — Sprints por proyecto y reporte de fin de sprint

- **ID:** 018-sprints-and-reporting
- **Plan reference:** `./plan.md`
- **Spec reference:** `./spec.md`
- **Estado:** done — 2026-09-16 (código); verificación manual pendiente

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

Fases:

- **Phase 1 — Database + triggers** (T1.1 – T1.6)
- **Phase 2 — API** (T2.1 – T2.5)
- **Phase 3 — Cliente: queries + tipos** (T3.1 – T3.4)
- **Phase 4 — UI: tab Sprint** (T4.1 – T4.5)
- **Phase 5 — UI: Backlog + Tablero completo + Old Sprints + reporte** (T5.1 – T5.5)
- **Phase 6 — Cierre** (T6.1 – T6.4)

---

## Phase 1 — Database + triggers

- [x] **T1.1** — Migration `00000000000016_sprints.sql`. Enum `sprint_status` (`planned|active|completed`). Tabla `sprints` con PK uuid, FK `project_id restrict`, `numero int not null`, `name text`, `goal text`, fechas, status, `closed_at`, `report jsonb`. Constraints: `sprints_dates_ok` (`ends_at >= starts_at`), `sprints_completed_has_closed_at` (status='completed' ↔ closed_at y report ambos not null), `sprints_numero_unique_per_project`. Índice `sprints_project_status_idx` compuesto, e índice **unique parcial** `sprints_one_active_per_project on (project_id) where status='active'` — el enforcement duro. _DoD: T1.6 (integración) — 2 activaciones simultáneas del mismo proyecto: una gana, la otra tira 23505._
- [x] **T1.2** — En la misma migration: `alter table tickets add sprint_id uuid references sprints(id) on delete set null`, más `estimated_hours numeric(5,2) check (estimated_hours is null or estimated_hours >= 0)`. Índice parcial `tickets_sprint_idx on (sprint_id) where sprint_id is not null`. _DoD: T1.6._
- [x] **T1.3** — En la misma migration: `alter table projects add next_sprint_number int not null default 1`. Análogo a `next_ticket_number`.
- [x] **T1.4** — Trigger `assign_sprint_number` (before insert), copia del patrón de `assign_ticket_number` de 015 T1.9 — lockea proyecto con `update ... returning`, asigna, incrementa. `when (new.numero is null)` para no pisar seeds. _DoD: T1.6 — 20 inserts paralelos en el mismo proyecto asignan `{1..20}` sin gaps._
- [x] **T1.5** — Trigger `enforce_sprint_status_transitions` (before update of status). Reglas: `planned→active` OK, `active→completed` OK **si closed_at y report ambos not null**, resto rechaza con `check_violation`. Es la garantía que un `active→completed` sin snapshot falla — el RPC de cierre siempre setea los tres juntos.
- [x] **T1.6** — **Extensión de `enforce_ticket_contributor_scope`** (migration 15 arregló el jsonb bug; ahora sumamos dos checks). Antes del path "3) Edit completo: solo si es propio" del actor contributor, agregar dos raises con `hint` para `sprint_id` y `estimated_hours` — no se permiten a contributor aunque el ticket sea propio. _DoD: T1.6._
- [x] **T1.7** — RPC `close_sprint_with_rollover(p_sprint_id uuid, p_next_sprint_id uuid)` security definer, `set search_path = public`. Adentro (transaccional):
  1. Valida que el sprint existe, está `active`, y `p_next_sprint_id` (si no null) pertenece al mismo proyecto y no es completado.
  2. Compone el snapshot desde `tickets` filtrado por `sprint_id = p_sprint_id`.
  3. `update tickets set sprint_id = p_next_sprint_id where sprint_id = p_sprint_id and status not in ('done','cancelled')`.
  4. `update sprints set status='completed', closed_at=now(), report=<snapshot>, updated_at=now()`.
  Return: `jsonb_build_object('rolled_over', <count>, 'report', <snapshot>)`.
- [x] **T1.8** — Grants + policies (`plan.md` §4). `grant select, insert, update on sprints to authenticated` (sin delete). Policies: read para miembros del proyecto (`can_view_project`), insert/update solo admin o PM primario. **La distinción PM-only para cerrar NO vive en la RLS** — vive en el handler.
- [x] **T1.9** — `pnpm db:push` contra el proyecto de Supabase, luego `pnpm db:types`. Verificar diff de `src/types/database.ts` (esperado: nuevo enum, nueva tabla, nuevas columnas de `tickets` y `projects`, nueva RPC).

---

## Phase 2 — API

- [x] **T2.1** — Zod schemas en `src/lib/validation/sprints.ts`: `createSprintSchema` (`project_id`, `starts_at`, `ends_at`, `name?`, `goal?`, con refine `ends_at >= starts_at`), `updateSprintSchema` (partial + refine no vacío; solo permite `status: 'active'` como transición). Re-exportar `sprintStatus` como `z.enum([...])` con `satisfies` contra el enum generado.
- [x] **T2.2** — Extender `updateTicketSchema` en `src/lib/validation/tickets.ts`: sumar `sprint_id: z.string().uuid().nullable().optional()` y `estimated_hours: z.number().nonnegative().nullable().optional()`.
- [x] **T2.3** — `POST /api/sprints` en `src/app/api/sprints/route.ts`. Guard `requireProjectMembership(body.project_id, 'pm')`. Insert con cast (numero lo pone el trigger, mismo patrón que 015 T5.1). Respuesta 201.
- [x] **T2.4** — `PATCH /api/sprints/[id]/route.ts`. Guard `requireProjectMembership(sprint.project_id, 'pm')`. Traduce 23505 sobre `sprints_one_active_per_project` a 409 con `reason: 'active_sprint_exists'`. Traduce 23514 del trigger a 400 con reason.
- [x] **T2.5** — `POST /api/sprints/[id]/close` en `src/app/api/sprints/[id]/close/route.ts`. Guards en orden: (a) `requireProjectMembership('pm')`, (b) `profile.id === project.pm_id` (rechaza admin — AC-5.4), (c) `sprint.status === 'active'`. Chequea si hay tickets no completados y si hay planificado siguiente. Devuelve 409 `{reason: 'needs_next_sprint'}` si falta el planificado. Si OK, llama a `supabase.rpc('close_sprint_with_rollover', { p_sprint_id, p_next_sprint_id })`.
- [x] **T2.6** — Extender `PATCH /api/tickets/[id]/route.ts` (015 T5.2): aceptar `sprint_id` y `estimated_hours` del schema extendido. Validaciones extra: si `sprint_id` no es null, verificar que pertenece al mismo proyecto y no está `completed` (rechaza con 400 y reason). Traducir el `hint` del trigger extendido a 403 con `reason`.

---

## Phase 3 — Cliente: queries + tipos

- [x] **T3.1** — `src/lib/sprints/status.ts`: `SPRINT_STATUS_ORDER`, `SPRINT_STATUS_LABELS` (`planned: "Planificado"`, `active: "Activo"`, `completed: "Cerrado"`). `Record<SprintStatus, string>` para forzar traducción de valores nuevos.
- [x] **T3.2** — `src/lib/sprints/keys.ts`: `formatSprintDisplayName({ name, numero })` — devuelve el name si existe o "Sprint N" si null. Puro, testeable, reusado en todos los headers y selectores.
- [x] **T3.3** — `src/lib/sprints/query.ts`:
  - `getActiveSprint(projectId)` — cacheado por request.
  - `getPlannedSprints(projectId)` — cacheado.
  - `getCompletedSprints(projectId)` — para "Old Sprints".
  - `getSprintByNumero(projectId, numero)` — para la vista de reporte.
  - Todas respetan RLS.
- [x] **T3.4** — Extender `getTicketsList` de `src/lib/tickets/query.ts` para aceptar `sprintId?: string | null` como filtro adicional (útil para el tab Sprint y para el Backlog scoped por proyecto sin sprint).

---

## Phase 4 — UI: tab Sprint

- [x] **T4.1** — Actualizar `src/app/(app)/projects/[projectKey]/page.tsx`: cambiar `redirect('.../board')` por `redirect('.../sprint')`. El default del workspace es el sprint activo.
- [x] **T4.2** — Actualizar `src/components/projects/project-workspace-header.tsx`: la barra de tabs pasa de `[Tablero, Backlog, (Miembros)]` a `[Sprint, Backlog, Tablero completo, Old Sprints, (Miembros)]`. El tab "Sprint" es default; el activo se sigue determinando por segmento del path.
- [x] **T4.3** — Crear `src/app/(app)/projects/[projectKey]/sprint/page.tsx`. Server component. Fetch: `getProjectByKey`, `getActiveSprint`, `getPlannedSprints`. Si hay activo, `getTicketsList({projectId, sprintId: active.id, statuses: all six})`. Delega en `<SprintTabContent>`.
- [x] **T4.4** — `<SprintTabContent>` cliente:
  - **Si hay activo:** `<SprintHeader>` (nombre, fechas, objetivo, barra de progreso de horas, warning si hay tickets sin estimar, botón "Cerrar sprint" solo para PM primario, menú "..." con "Editar sprint") + `<KanbanBoard>` (reuso, filtrado a tickets del sprint).
  - **Si no hay activo pero hay planificados:** empty state "Activá un sprint planificado" + lista de planificados con botón "Activar".
  - **Si no hay ninguno:** empty state "Sin sprints en este proyecto" + `<CreateSprintButton>`.
  - Al pie, siempre que sea admin/PM: `<PlannedSprintsList>` con botón "Activar" (habilitado solo si no hay activo) y link para editar cada uno.
- [x] **T4.5** — `<CreateSprintButton>` (patrón de `<CreateTicketButton>` de 015): dialog con fechas obligatorias, nombre y objetivo opcionales, `POST /api/sprints`. `<EditSprintDialog>` reusa el mismo form en modo edit.
- [x] **T4.6** — `<CloseSprintDialog>` — dialog de confirmación del cierre. Recibe el sprint y la lista de planificados. Tres estados:
  1. Sin tickets pendientes: mensaje corto + botón "Cerrar sprint".
  2. Con pendientes + hay `planned`: nombra el próximo sprint, cuenta los tickets a rollover, botón "Cerrar y mover N tickets a <nombre>".
  3. Con pendientes + NO hay `planned`: mensaje bloqueante + botón "Crear próximo sprint" que abre `<CreateSprintButton>` en dialog anidado. Al terminar, el `<CloseSprintDialog>` refetchea planificados y vuelve al estado 2.

---

## Phase 5 — UI: Backlog + Tablero completo + Old Sprints + reporte

- [x] **T5.1** — `<TicketList>` (015 T7.3) suma columna **"Sprint"** con el nombre del sprint o "Backlog". Cliente ganan un `<Select>` inline para cambiar (visible solo para admin/PM/lead — se pasa un flag `canReassignSprint` desde el server component). Otra columna **"Est. hs"** con input inline (misma condición de permiso).
- [x] **T5.2** — Nuevo tab "Tablero completo" en `/projects/[projectKey]/board/page.tsx` — sin cambios funcionales; el `page.tsx` existente ya muestra todos los tickets, solo cambia el label del tab.
- [x] **T5.3** — `/projects/[projectKey]/sprints/page.tsx` (Old Sprints). Server component. Fetch `getCompletedSprints`. Tabla con Número/Nombre, Fechas, Cerrado el, Tickets (X/Y), Horas (X/Y), acción "Ver reporte". Fila clickeable → `.../sprints/[numero]`.
- [x] **T5.4** — `/projects/[projectKey]/sprints/[numero]/page.tsx` — vista de reporte. Fetch `getSprintByNumero`. Si `status !== 'completed'` → `notFound()`. Renderiza header + métricas del snapshot + tabla "Por asignado" + lista de tickets del sprint (leyendo del `report jsonb`, no de tickets actuales — R-2 del spec) + nota de "Congelado el DD/MM/YYYY".
- [x] **T5.5** — Componentes de visualización del reporte en `src/components/sprints/`: `<SprintReport>` (contenedor), `<SprintReportMetrics>` (grid de métricas), `<SprintReportByAssignee>` (tabla), `<SprintReportTickets>` (lista con status final).

---

## Phase 6 — Cierre

- [ ] **T6.1** — Actualizar `specs/features/README.md`: `018` como done con una línea de resumen.
- [ ] **T6.2** — Actualizar `CLAUDE.md`:
  - Estructura del repo: nuevas rutas `projects/[key]/sprint`, `/sprints`, `/sprints/[numero]`.
  - Estado de features: sumar 018.
  - Sección "Reservas" o análoga: bullet sobre el trigger de contributor-scope extendido en migration 16 (F6 de 015 se relaciona — tests de UPDATE de sprint_id/estimated_hours).
- [ ] **T6.3** — Actualizar 015 tasks.md: la extensión del trigger `enforce_ticket_contributor_scope` que hace 018 T1.6 se registra como cross-feature con link a este `tasks.md`.
- [ ] **T6.4** — Verificación visual del usuario: crear sprint → activarlo → mover tickets desde el backlog → estimar horas → cerrar con y sin planificado siguiente → ver reporte en Old Sprints. Probar como admin (todo salvo cerrar), como PM (todo), como lead (mover tickets), como contributor (nada de sprints, solo trabajar en su ticket).

---

## Blocked / follow-ups

- [ ] **F1 — Horas cargadas vs estimadas en el reporte.** Depende de `016-time-tracking`. Cuando esté, el `<SprintReport>` suma una sección "Horas reales" leyendo de `time_entries` filtradas por `ticket_id in (sprint's tickets)` y `created_at between sprint.starts_at and sprint.closed_at`. Se puede congelar en `report.actual_hours` la primera vez que se abre post-016 (o mantener siempre calculada — decisión de scope entonces).
- [ ] **F2 — Velocity chart cross-sprints.** Una vez que hay ≥ 3 sprints cerrados, tiene sentido un gráfico de horas est. completadas por sprint para ver tendencia. Sencillo cuando exista la data; sin urgencia hoy.
- [ ] **F3 — Retrospectiva colaborativa** (comentarios de sprint, action items). Feature aparte cuando el equipo lo pida.
- [ ] **F4 — Delete de sprints planificados.** Si un `planned` ya no se va a usar, hoy hay que dejarlo (o cambiarle fechas). Un `POST /api/sprints/:id/delete` (soft o hard) es trivial si duele.
- [ ] **F5 — Rollover a un sprint elegido (no siempre el próximo).** Hoy los rolleados van al `planned` con `starts_at` más cercano. Si el PM quiere elegir otro, un dropdown en el `<CloseSprintDialog>` resuelve. Fuera de scope de MVP.
- [ ] **F6 — Auto-activación de sprints por fecha.** Descartado en el cuestionario, pero si el equipo lo pide después (para no olvidarse de activar el próximo el lunes), un cron simple en `vercel.json` que llama a `PATCH /api/sprints/:id { status: 'active' }` para sprints cuyo `starts_at` ya llegó y no hay otro activo, es una addition sin cambio de modelo.
