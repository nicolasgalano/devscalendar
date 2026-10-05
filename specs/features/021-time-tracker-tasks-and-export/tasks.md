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

- [x] **T1.1** — `src/components/projects/project-activities-panel.tsx` (8 strings UI, no 10 — el conteo del plan incluía algunos en comentarios): CTA, count sentence, empty state, dialog titles ("Nueva/Renombrar tarea"), confirm de desactivar, sync label del pill. Comentario del header reescrito con la nota "en la UI se llama Tarea; en el schema la tabla sigue siendo `project_activities`" como puente.
- [x] **T1.2** — Componentes de time tracking:
  - `src/components/time-entries/time-entry-dialog.tsx`: 4 strings (placeholders del select "Elegí una tarea" / "Sin tarea" en el ternario + el `<SelectItem>` + el mensaje "no tiene tareas definidas"). Comentario del JSDoc actualizado para alinear con "Tarea y ticket".
  - `src/components/timer-pill.tsx`: 1 string ("Sin tarea" en el fallback del label).
- [x] **T1.3** — Workspace del proyecto:
  - `src/app/(app)/projects/[projectKey]/activities/page.tsx`: cero strings UI (el único "Actividades" estaba en el JSDoc, que fue actualizado para reflejar la UI nueva). El segmento URL `/activities` se preserva.
  - `src/components/projects/project-workspace-header.tsx`: 1 string (`label="Tareas"` en la tab).
- [x] **T1.4** — Vistas transversales:
  - `src/app/(app)/my-time/page.tsx`: cero strings UI (ambas ocurrencias estaban en comentarios, actualizados para alinear con "tareas").
  - `src/components/tickets/ticket-detail.tsx`: cero strings UI (la única ocurrencia estaba en el JSDoc del prop `projectActivities`, actualizado).
- [x] **T1.5** — Test guardrail `tests/unit/rename-tareas.test.ts`. **Solo escanea `.tsx`** (no `.ts` como decía esta nota originalmente) — alineado con plan §3.4, excluye `src/app/api/*/route.ts`. Walker recursivo sobre `src/components` y `src/app`, strip de comentarios de línea y bloque, regex `\bactividad(es)?\b` case-insensitive. `EXCLUSION_LIST: string[] = []`. `pnpm test:unit` verde (240/240 tests).

---

## Phase 2 — Reporte planilla: helper + serializers + endpoints

Refactor del pipeline de export para producir las 11 columnas alineadas con la planilla de referencia. Dos serializers que comparten query y mapeo (plan §4.1). **El shape del CSV cambia** (breaking change confirmado — Q-3 del plan: sin consumidores externos automatizados conocidos).

- [x] **T2.1** — `pnpm add exceljs` 4.4.0. Trae sus propios types; `package.json` suma una sola dep.
- [x] **T2.2** — Helper compartido `src/lib/reports/time-entries-report.ts`:
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
- [x] **T2.3** — Serializer CSV `src/lib/reports/serialize-csv.ts`: `serializeReportToCsv(rows: ReportRow[]): string`. Headers en español desde `REPORT_COLUMNS`. Fechas como `dd/mm/yyyy HH:mm` (consistente con XLSX, R-4 del plan). `horas` con `.toFixed(2)`. `ticketKey` emitido como string plano (CSV no soporta hyperlink; `ticketUrl` no se emite). Reusar el helper `escapeCsv` del handler actual (comilla doble envolvente si contiene coma, comilla o salto; comillas internas se duplican).
- [x] **T2.4** — Serializer XLSX `src/lib/reports/serialize-xlsx.ts`: `serializeReportToXlsx(rows: ReportRow[]): Promise<Buffer>` con `exceljs`. Un solo sheet "Planilla". Anchos de columna del plan §4.3 (Cliente 20, Proyecto 20, Usuario 20, Tarea 20, Fecha inicio 18, Fecha fin 18, Zona horaria 22, Duración 10, Horas 8, Notas 40, Ticket 12). Celdas tipadas: `Date` con `numFmt = "dd/mm/yyyy hh:mm"` (locale-neutral — mitiga R-9 del plan: Excel no reinterpreta por locale del cliente), `horas` numérica con `numFmt = "0.00"`, `ticketKey` con URL como `{ text, hyperlink }`. Header row con `font = { bold: true }`.
- [x] **T2.5** — Refactor `src/app/api/time-entries/export.csv/route.ts`:
  - Handler delgado: `getCurrentProfile()` → guard admin/PM (403 si no) → `exportQuerySchema.safeParse()` → `queryTimeEntriesForReport()` → `serializeReportToCsv()` → `Response`.
  - **Breaking change de headers y nombre de archivo**: pasa de `time-entries-<from>-to-<to>.csv` a `planilla-<from>-a-<to>.csv`. Documentar en el commit.
  - `Content-Type: text/csv; charset=utf-8`.
- [x] **T2.6** — Nuevo endpoint `src/app/api/time-entries/export.xlsx/route.ts`. Mismo patrón que T2.5 pero con `serializeReportToXlsx`. **Import dinámico de `exceljs`** (`const ExcelJS = await import("exceljs")`) para no pagar cold start en el resto del bundle server. `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. `Content-Disposition: attachment; filename="planilla-<from>-a-<to>.xlsx"`.
- [x] **T2.7** — Cero tests existentes referenciaban el shape viejo del CSV (grep de `user_email|user_nombre|ticket_titulo|cargado_por|export\.csv` en `tests/` da vacío). El único call site del endpoint es `src/components/reports/report-filters-bar.tsx` que arma el href — se migra en Phase 3. 240/240 unit tests siguen verdes.

---

## Phase 3 — UI del botón export

- [x] **T3.1** — `<DropdownMenu>` ya instalado desde 022 (lo usa `<TimerPill>`). Sin acción.
- [x] **T3.2** — `src/components/reports/report-filters-bar.tsx`: el `<a href>` único reemplazado por `<DropdownMenu>` con trigger `Exportar ▾` (Button variant outline sm) y dos `<DropdownMenuItem render={<a download />}>` para CSV y XLSX. Query string construido una sola vez. Patrón `render={...}` para que el browser dispare descarga nativa — sin fetch, sin loading state.

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
