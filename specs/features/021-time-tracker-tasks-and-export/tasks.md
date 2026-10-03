# Tasks — Tareas (rename) + reporte planilla con export XLSX

- **ID:** 021-time-tracker-tasks-and-export
- **Plan reference:** `./plan.md`
- **Spec reference:** `./spec.md`
- **Estado:** draft

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

Fases:

- **Phase 1 — Rename UI Actividades → Tareas** (T1.1 – T1.5)
- **Phase 2 — Reporte planilla: helper + serializers + endpoints** (T2.1 – T2.7)
- **Phase 3 — UI del botón export** (T3.1 – T3.2)
- **Phase 4 — Cierre** (T4.1 – T4.4)

---

## Phase 1 — Rename UI Actividades → Tareas

Pass de reemplazos de strings sobre 8 archivos del frontend. Cero base, cero API, cero types. Identificadores de código (`activityId`, `activity_id`, `project_activities`, `ActivitiesPanel`), segmento URL `/activities` y el campo `activity` en JSON de la API **se conservan** — es solo UI visible (plan §3.2).

- [ ] **T1.1** — `src/components/projects/project-activities-panel.tsx` (10 ocurrencias): título "Actividades" → "Tareas", CTA "+ Nueva actividad" → "+ Nueva tarea", header del form, empty state, mensajes de validación / confirmación de delete, texto del toggle active/inactive. Preservar los comentarios del código que mencionen `project_activities` como tabla; sumar al primero una nota "(en la UI se llama Tarea)" como puente para el próximo lector.
- [ ] **T1.2** — Componentes de time tracking:
  - `src/components/time-entries/time-entry-dialog.tsx` (4 occ): label del `<Select>` "Actividad" → "Tarea", placeholders "Elegí una actividad" / "Sin actividad" → "Elegí una tarea" / "Sin tarea", mensaje "El proyecto no tiene actividades activas" → "…tareas activas".
  - `src/components/timer-pill.tsx` (1 occ): tooltip/label del cronómetro que muestra la tarea activa.
- [ ] **T1.3** — Workspace del proyecto:
  - `src/app/(app)/projects/[projectKey]/activities/page.tsx` (1 occ): heading de la página → "Tareas". El segmento URL `/activities` **se conserva** — no romper bookmarks.
  - `src/components/projects/project-workspace-header.tsx` (1 occ): label de la tab de "Actividades" → "Tareas".
- [ ] **T1.4** — Vistas transversales:
  - `src/app/(app)/my-time/page.tsx` (2 occ): headings o filtros que aludan a actividad.
  - `src/components/tickets/ticket-detail.tsx` (1 occ): chip/label de la columna "Tarea" en el listado de horas cargadas.
- [ ] **T1.5** — Test guardrail `tests/unit/rename-tareas.test.ts` (plan §3.4 + §6.1). Lee recursivo `src/components/**/*.{ts,tsx}` + `src/app/**/*.{ts,tsx}`, remueve comentarios de línea (`//…`) y de bloque (`/*…*/`), busca `\bactividad(es)?\b` case-insensitive. Falla ruidoso con lista de `{file, line, text}` si hay match. `EXCLUSION_LIST` empieza vacía — se llena solo si aparece un caso legítimo, con comentario del PR que lo explique. _DoD: T1.1 – T1.4 completos; `pnpm test:unit` verde._

---

## Phase 2 — Reporte planilla: helper + serializers + endpoints

Refactor del pipeline de export para producir las 11 columnas alineadas con la planilla de referencia. Dos serializers que comparten query y mapeo (plan §4.1). **El shape del CSV cambia** (breaking change confirmado — Q-3 del plan: sin consumidores externos automatizados conocidos).

- [ ] **T2.1** — `pnpm add exceljs`. Sin `@types/exceljs` (trae sus propios types). Verificar `package.json` queda ordenado y `pnpm install` idempotente.
- [ ] **T2.2** — Helper compartido `src/lib/reports/time-entries-report.ts`:
  - Type `ReportRow` con los 11 campos (plan §4.1): `cliente, proyecto, usuario, tarea, fechaInicio, fechaFin, zonaHoraria, duracion, horas, notas, ticketKey, ticketUrl`.
  - Constante `REPORT_COLUMNS` (key + header en español, orden del AC-2.3).
  - `queryTimeEntriesForReport(filters: ExportQueryInput): Promise<ReportRow[]>` — select con embeds (`project.client.name`, `project.key`, `user.full_name`, `activity.name`, `ticket.numero`), filtros por `clientId`/`projectId`/`userId`/rango, mapeo `entry → ReportRow`. **Cierra el TODO del `route.ts` actual** que arma el ticket key con un segundo query.
  - `fechaInicio`: composición `logged_at + start_time`; fallback a `00:00` si `start_time` es null (AC-2.4).
  - `fechaFin`: `fechaInicio + minutes`.
  - `duracion`: `HH:MM` con leading zeros.
  - `horas`: `minutes / 60` numérico (sin redondeo acá — el serializer formatea).
  - `zonaHoraria`: fijo `"America/Argentina/Buenos_Aires"` (Q-5 del plan).
  - `ticketUrl`: `${process.env.NEXT_PUBLIC_SITE_URL}/tickets/<key>` si la var existe; `null` si no.
  - **El helper no filtra por permisos** — asume que el caller autorizó. La RLS de `time_entries` sigue vigente en el select.
- [ ] **T2.3** — Serializer CSV `src/lib/reports/serialize-csv.ts`: `serializeReportToCsv(rows: ReportRow[]): string`. Headers en español desde `REPORT_COLUMNS`. Fechas como `dd/mm/yyyy HH:mm` (consistente con XLSX, R-4 del plan). `horas` con `.toFixed(2)`. `ticketKey` emitido como string plano (CSV no soporta hyperlink; `ticketUrl` no se emite). Reusar el helper `escapeCsv` del handler actual (comilla doble envolvente si contiene coma, comilla o salto; comillas internas se duplican).
- [ ] **T2.4** — Serializer XLSX `src/lib/reports/serialize-xlsx.ts`: `serializeReportToXlsx(rows: ReportRow[]): Promise<Buffer>` con `exceljs`. Un solo sheet "Planilla". Anchos de columna del plan §4.3 (Cliente 20, Proyecto 20, Usuario 20, Tarea 20, Fecha inicio 18, Fecha fin 18, Zona horaria 22, Duración 10, Horas 8, Notas 40, Ticket 12). Celdas tipadas: `Date` con `numFmt = "dd/mm/yyyy hh:mm"` (locale-neutral — mitiga R-9 del plan: Excel no reinterpreta por locale del cliente), `horas` numérica con `numFmt = "0.00"`, `ticketKey` con URL como `{ text, hyperlink }`. Header row con `font = { bold: true }`.
- [ ] **T2.5** — Refactor `src/app/api/time-entries/export.csv/route.ts`:
  - Handler delgado: `getCurrentProfile()` → guard admin/PM (403 si no) → `exportQuerySchema.safeParse()` → `queryTimeEntriesForReport()` → `serializeReportToCsv()` → `Response`.
  - **Breaking change de headers y nombre de archivo**: pasa de `time-entries-<from>-to-<to>.csv` a `planilla-<from>-a-<to>.csv`. Documentar en el commit.
  - `Content-Type: text/csv; charset=utf-8`.
- [ ] **T2.6** — Nuevo endpoint `src/app/api/time-entries/export.xlsx/route.ts`. Mismo patrón que T2.5 pero con `serializeReportToXlsx`. **Import dinámico de `exceljs`** (`const ExcelJS = await import("exceljs")`) para no pagar cold start en el resto del bundle server. `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. `Content-Disposition: attachment; filename="planilla-<from>-a-<to>.xlsx"`.
- [ ] **T2.7** — Actualizar tests existentes de 016 que esperen el shape viejo del CSV (`fecha, user_email, user_nombre, …`) a los nuevos headers en español. Si no hay tests que lo validen contra expectations específicas, no se agrega — plan §6.2 decide explícitamente **no** sumar unit del serializer XLSX ni integration test del endpoint.

---

## Phase 3 — UI del botón export

- [ ] **T3.1** — Verificar que `<DropdownMenu>` de shadcn está instalado (`ls src/components/ui/dropdown-menu.tsx`). Si no, `pnpm dlx shadcn@latest add dropdown-menu` y ajustar a la escala de densidad del preset Nova (ADR 0006, mismo pattern que el resto de `src/components/ui/`).
- [ ] **T3.2** — Modificar `src/components/reports/report-filters-bar.tsx`: reemplazar el link/botón único de export por un `<DropdownMenu>`:
  - Trigger: `<Button variant="outline" size="sm">Exportar <ChevronDownIcon /></Button>`.
  - Dos ítems `<DropdownMenuItem asChild>` con `<a href>` a `/api/time-entries/export.csv?<query>` y `/api/time-entries/export.xlsx?<query>` respectivamente. Mismo query string construido una sola vez.
  - El browser dispara la descarga nativa — sin `fetch`, sin loading state (plan §5.1, consistente con el comportamiento actual del CSV).

---

## Phase 4 — Cierre

- [ ] **T4.1** — Actualizar `specs/features/README.md`: 021 pasa de `draft (spec + plan)` a `done (deployed YYYY-MM-DD)` con una línea de resumen (rename cosmético UI + reporte alineado con planilla comercial + XLSX nuevo).
- [ ] **T4.2** — Actualizar `CLAUDE.md`:
  - Estructura del repo: sumar `src/lib/reports/` (helper + dos serializers).
  - Estado de features: línea para 021 con el invariante clave ("rename cosmético UI; schema sigue en `project_activities`; export CSV + XLSX comparten pipeline").
  - **Nota en Convenciones** (sección a elegir — podría ir dentro de "Rutas y permisos" o una nueva "Reportes y vocabulario"): **"Tarea" en UI = `project_activities` en schema**. El próximo lector que vea `activity_id` o `ActivitiesPanel` necesita el puente — este es exactamente el patrón que justifica el ADR 0002.
- [ ] **T4.3** — Si `docs/adr/0002-language-conventions.md` lista ejemplos del patrón schema-en-inglés / producto-en-español, sumar "Actividad (schema `project_activities`) → Tarea (UI)". Si no lista ejemplos, no se agrega.
- [ ] **T4.4** — Verificación visual del usuario:
  - Workspace del proyecto → tab dice "Tareas", heading de la página dice "Tareas", CTA dice "+ Nueva tarea".
  - `<TimeEntryDialog>` abierto desde `/my-time` → dropdown dice "Tarea", placeholders dicen "Elegí una tarea" / "Sin tarea".
  - `<TimerPill>` corriendo → label de la tarea activa dice "Tarea" (no "Actividad").
  - `/reports` → botón "Exportar ▾" con dos ítems (CSV, XLSX).
  - Descargar XLSX con rango de ~1 mes, abrir en **Excel y Google Sheets**: 11 columnas en orden correcto, fechas tipadas como fecha (no string, se puede ordenar como fecha), horas como número con 2 decimales (se puede sumar), hyperlink en Ticket clickeable que abre `/tickets/PROJ-N`.
  - Descargar CSV, abrir en Google Sheets: mismas 11 columnas, nombres en español.
  - Reporte de sprint viejo cerrado de 018 → sigue mostrando "Tarea: <nombre>" en la sección "Horas cargadas" (snapshot inmutable, no se tocó — Q-6 del plan).
  - Correr `pnpm test:unit` → verde (incluye el guardrail de T1.5).

---

## Blocked / follow-ups

- [ ] **F1 — Filtro por "Tarea" en `<ReportFiltersBar>`.** Hoy los filtros son cliente/proyecto/usuario. Sumar tarea es aditivo (entry en el componente + en `exportQuerySchema`). Fuera de scope de esta feature. Se agrega si el equipo lo pide.
- [ ] **F2 — XLSX del reporte de sprint (018).** El pipeline de `src/lib/reports/` de esta feature es reusable para exportar el snapshot `sprints.report jsonb` como XLSX. Spec aparte cuando se decida — el reporte de sprint hoy es solo HTML.
- [ ] **F3 — Concepto de "Servicio" global.** El Excel de origen tiene una columna "Servicio" (Development / Analysis / Meeting / Training / Management) cross-project. Equipo comercial confirmó que no es prioritario hoy. Si entra: nueva tabla `services` (o enum global), columna `time_entries.service_id nullable`, posición 4 en el reporte (antes de "Tarea"). No breaking — filas viejas con `service_id null` → celda vacía.
- [ ] **F4 — `profiles.timezone`.** La columna "Zona horaria" del reporte está hardcoded a `America/Argentina/Buenos_Aires`. Si entra alguien en otra TZ: agregar `profiles.timezone text default 'America/Argentina/Buenos_Aires'` y usarlo en el mapeo del helper. La columna del layout ya existe — solo cambia el valor.
- [ ] **F5 — Streaming XLSX para rangos grandes.** Hoy serializa a buffer entero en memoria. Con ~500 entries actuales está sobrado. Si en el futuro aparece timeout en Vercel con rangos de más de ~10k filas, pasar a `workbook.xlsx.write(writableStream)` sobre `Response(stream)`. No urge con el volumen actual (plan R-3).
- [ ] **F6 — Loading state / botón deshabilitado si falta rango obligatorio.** Hoy si el usuario clickea Export sin rango, el server responde 400 y el browser abre una página con JSON de error. UX pobre pero ya pasa igual con el CSV actual. Fuera de scope — se arregla cuando aparezca pedido explícito (plan §5.2).
