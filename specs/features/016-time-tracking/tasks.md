# Tasks — Carga de horas (time tracking)

- **ID:** 016-time-tracking
- **Plan reference:** `./plan.md`
- **Spec reference:** `./spec.md`
- **Estado:** done — 2026-09-16 (código); verificación manual pendiente

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

Fases:
- Phase 1 — DB + triggers + RLS (T1.x)
- Phase 2 — API (T2.x)
- Phase 3 — Cliente domain (T3.x)
- Phase 4 — UI Mi Semana + timer + dialogs (T4.x)
- Phase 5 — Ticket detail + tab Actividades (T5.x)
- Phase 6 — Reportes + export CSV (T6.x)
- Phase 7 — Sprint enriquecido + notificaciones + cierre (T7.x)

---

## Phase 1 — DB + triggers + RLS

- [ ] **T1.1** — Migration `00000000000017_time_tracking.sql`. `alter type user_role add value 'staff'`. Tablas `project_activities` (con unique parcial `where active = true`), `time_entries` (con checks de minutos múltiplos de 15), `active_timers` (con PK user_id).
- [ ] **T1.2** — Extensión de `notifications.type` check con `time_entry_created_by_other` y `time_entry_deleted_by_admin`. Sumar `time_entry_id uuid nullable` a `notifications` (mismo patrón que `ticket_id` de 015).
- [ ] **T1.3** — Triggers: `audit_time_entries` (insert/update/delete → audit_log), `notify_time_entry_events` (insert por otro / delete por admin), `touch_time_entry_updated_at`, `audit_project_activities`.
- [ ] **T1.4** — RPCs `stop_timer(user_id)` y `stop_and_start_timer(user_id, project_id, ticket_id, activity_id)` — `security definer`, `set search_path = public`, transaccionales.
- [ ] **T1.5** — Grants + policies: `time_entries` (read, insert self+admin/PM/lead-for-other, update/delete own+admin), `active_timers` (all only own), `project_activities` (read, write admin/PM). **Primera vez con `delete` a `authenticated`** — documentar en migration.
- [ ] **T1.6** — `pnpm db:push` + `pnpm db:types` + `prettier --write src/types/database.ts`. Verificar diff — enum extendido, 3 tablas nuevas, 2 RPCs, notifications extendido.

---

## Phase 2 — API

- [ ] **T2.1** — Zod schemas en `src/lib/validation/time-entries.ts`: `createTimeEntrySchema` (project_id req, ticket_id/activity_id opcionales con validación cross), `updateTimeEntrySchema` (partial, refine no vacío), `startTimerSchema`, `logExportQuerySchema`. En `src/lib/validation/project-activities.ts`: `createActivitySchema`, `updateActivitySchema`. Sumar `staff` a `userRolesSchema` (015 lo tenía como `[admin, pm, developer]`).
- [ ] **T2.2** — `POST /api/time-entries` — validar `activity_required` cuando el proyecto tiene actividades activas. Verificar ticket ↔ project match. Traducir el 23514 del check a 400 con reason.
- [ ] **T2.3** — `PATCH /api/time-entries/:id` — enforcement de ventana de 7 días (user vs admin). Traducir 403 con `reason: 'edit_window_expired'`.
- [ ] **T2.4** — `DELETE /api/time-entries/:id` — misma lógica de ventana. Antes de eliminar, capturar snapshot para audit.
- [ ] **T2.5** — `POST /api/time-entries/timer/start` — llama a `stop_and_start_timer` RPC. Devuelve `{ started_at, stopped_entry_id? }`.
- [ ] **T2.6** — `POST /api/time-entries/timer/stop` — llama a `stop_timer` RPC. Devuelve `{ entry_id }` o 404 si no había timer.
- [ ] **T2.7** — `POST /api/project-activities` y `PATCH /api/project-activities/:id`. Guard admin o PM del proyecto. Traducir unique violation a 409 con reason.
- [ ] **T2.8** — `GET /api/time-entries/export.csv` — query con filtros, respeta scope del viewer, stream `text/csv` con headers CSV escapeados (comas, comillas, saltos de línea).

---

## Phase 3 — Cliente domain

- [ ] **T3.1** — `src/lib/time-entries/status.ts`: constantes de formatos, labels si aplican, helpers `formatMinutes(mins)` (para "1h 30min" o "1:30").
- [ ] **T3.2** — `src/lib/time-entries/week.ts`: `getWeekStart(date, tz)`, `getWeekDays(weekStart)`, parsing de `?w=YYYY-MM-DD` con default a semana actual. Nunca tira.
- [ ] **T3.3** — `src/lib/time-entries/query.ts`: `getTimeEntriesForWeek(userId, weekStart)`, `getTimeEntriesForTicket(ticketId)`, `getMyActiveTimer()`, `getConsumoReport(filters)`, `getPlanVsRealReport(filters)`.
- [ ] **T3.4** — `src/lib/project-activities/query.ts`: `getActivitiesForProject(projectId, {includeInactive?: boolean})`.
- [ ] **T3.5** — `src/lib/time-entries/permissions.ts`: `canEditTimeEntry(entry, viewer)` con la ventana de 7 días. Reusa `isAdmin`.

---

## Phase 4 — UI Mi Semana + timer + dialogs

- [ ] **T4.1** — Sidebar: ítem **"Mi Tiempo"** (`/my-time`, icono `TimerIcon`) para todos autenticados. Se agrega en `BASE_NAV` de `AppShell` después de "Mi trabajo".
- [ ] **T4.2** — `src/app/(app)/my-time/page.tsx` + `loading.tsx`. Server component: fetch de la semana, del user seleccionado (default self), proyectos accesibles (para el dialog), lista de asignables (para el user selector si tiene permiso). Delega en `<WeeklyGridView>`.
- [ ] **T4.3** — `<WeeklyGridView>` cliente: layout de 7 columnas, headers con fecha + total, cards apiladas, navegación semanal. Botón "+" abre dialog.
- [ ] **T4.4** — `<TimeEntryCard>`: renderiza una entry con KEY, actividad, minutos, descripción truncada, badge "cargada por X" si `created_by ≠ user_id`. Hover muestra edit/delete si permitido. Click abre ticket o edit.
- [ ] **T4.5** — `<TimeEntryDialog mode="create|edit">`: reusado. Campos proyecto (create), actividad (cuando el proyecto tiene), ticket (autocomplete opcional), fecha, minutos (con botones `+15` `+30` `+60` para carga rápida), descripción.
- [ ] **T4.6** — `<TimerPill>` en el `AppShell` header: consume server-fetch del active_timer, renderiza pill fijo si hay timer, cronómetro live-updated con `setInterval`. Menú con "Parar y guardar" | "Descartar". Badge warning si > 12h.
- [ ] **T4.7** — `<StartTimerDialog>`: variante del TimeEntryDialog sin campos de fecha ni minutos (los pone el timer). Se abre desde el botón "Iniciar cronómetro" del header o del ticket.
- [ ] **T4.8** — Selector de usuario en `/my-time` visible solo si `hasPmScope(profile)` (nuevo helper). Badge "Viendo la semana de X" cuando corresponde.

---

## Phase 5 — Ticket detail + tab Actividades

- [ ] **T5.1** — Sección **"Horas cargadas"** en `<TicketDetail>`. Header con total (y comparación con `estimated_hours` si el ticket tiene). Lista de entries con actor, fecha, minutos, descripción, botones edit/delete si autor o admin. Botón "Cargar tiempo" abre `<TimeEntryDialog>` con `ticket_id` pre-seleccionado.
- [ ] **T5.2** — `src/app/(app)/projects/[projectKey]/activities/page.tsx` + `loading.tsx`. Guard admin/PM (mismo patrón que members). Delega en `<ProjectActivitiesPanel>`.
- [ ] **T5.3** — `<ProjectActivitiesPanel>`: tabla con nombre + estado + acciones. Dialog para agregar. Toggle desactivar (con confirmación). Toggle reactivar directo.
- [ ] **T5.4** — Actualizar `<ProjectWorkspaceHeader>` para sumar la tab "Actividades" entre "Old Sprints" y "Miembros", visible solo si `canManageActivities` (admin o PM del proyecto).
- [ ] **T5.5** — Guard `page.tsx` del tab: redirect a `/sprint` si el viewer no puede administrar.

---

## Phase 6 — Reportes + export CSV

- [ ] **T6.1** — Sidebar: ítem **"Reportes"** para admin y PMs de al menos un proyecto. `hasPmScope` helper en `src/lib/auth/roles.ts` que resuelve la pertenencia.
- [ ] **T6.2** — `/reports/page.tsx`: redirect a `/reports/consumo`.
- [ ] **T6.3** — `/reports/consumo/page.tsx` + `loading.tsx`. Server component. `getConsumoReport(filters)` con groupBy `cliente|proyecto|persona|actividad`. Filtros combinables en URL. Tabla con horas cargadas + subtotales.
- [ ] **T6.4** — `/reports/plan-vs-real/page.tsx` + `loading.tsx`. Server component. Dos queries agregadas (bookings y time_entries) por (proyecto × persona × período). Tabla con `plan`, `real`, `delta`, `%`. Filtros `from`, `to`, `clientId`, `projectId`, `userId`.
- [ ] **T6.5** — Botón "Exportar CSV" en cada reporte que arma la URL de `/api/time-entries/export.csv` con los filtros actuales.

---

## Phase 7 — Sprint enriquecido + notificaciones + cierre

- [ ] **T7.1** — Sumar sección **"Horas cargadas"** en `<SprintReport>` (018). Live query de entries del sprint (tickets del sprint × rango de fechas). Total + breakdown por asignado + comparación estimado-vs-cargado. Nota "Horas cargadas: calculadas al momento de abrir esta página".
- [ ] **T7.2** — Extender `NOTIFICATION_TYPES` en `src/lib/notifications/events.ts` con `time_entry_created_by_other` y `time_entry_deleted_by_admin`. Templates de título / body en español. Href: al `/my-time?w=<semana>&entry=<id>` (o al ticket si tiene).
- [ ] **T7.3** — Extender `NotificationRow` con `timeEntryId` (nullable) — mismo patrón que `ticketId` de 015. Actualizar `getMyNotifications` para incluirlo.
- [ ] **T7.4** — Actualizar `specs/features/README.md` sumando 016 como done.
- [ ] **T7.5** — Actualizar `CLAUDE.md`:
  - Estructura del repo: nuevas rutas `/my-time`, `/reports/*`, `projects/[key]/activities`.
  - Estado de features: 016 done.
  - Sección "Reservas" o análoga: convención de time_entries (primera vez con DELETE en authenticated).
  - Rol `staff`: qué habilita y qué no.
- [ ] **T7.6** — Verificación visual del usuario en browser: cargar entries manual, arrancar cronómetro, ver Mi Semana, cargar por otro (admin), probar los tres reportes, exportar CSV.
