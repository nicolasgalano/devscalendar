# Spec — Carga de horas (time tracking)

- **ID:** 016-time-tracking
- **Estado:** ready
- **Referencias:** `015-project-membership-and-tickets` (tickets, membresías), `018-sprints-and-reporting` (reporte de sprint), `010-notifications-and-audit`, `012-multiple-roles-and-active-enforcement`. Fuera de la spec funcional original.

> **Nota histórica**: existió una spec previa (versión larga, orientada a reemplazar TrackingTime completo incluyendo plata, moneda, cupos, valorización). Esta spec la reemplaza — se descartó todo lo monetario y se simplificaron cupos, ausencias y bookings.ticket_id. Se conservaron: cronómetro persistido, rol `staff`, ventana de edición de 7 días, y el patrón general de reportes.

---

## 1. Objetivo

Reemplazar TrackingTime como plataforma de tracking de horas. Los miembros de un proyecto cargan tiempo contra tickets (015) o directamente contra un proyecto + actividad (para reuniones, coordinación, etc.). El reporte de sprint (018) suma "horas cargadas" y se habilitan reportes cross-proyecto de consumo y plan-vs-real (bookings vs entries).

**Sin plata, sin moneda, sin tarifas, sin cupos ni valorización.** La versión pública solo mide horas.

---

## 2. Contexto

WeDo Web hoy usa TrackingTime. Este slug lo reemplaza. La motivación:

1. **Time entries apuntan a tickets locales** (015). Sin tickets propios, cualquier tracker externo queda desconectado del trabajo.
2. **Plan-vs-real dentro del mismo producto**: `bookings` (compromiso) vs `time_entries` (realidad). Ningún tracker externo lo hace porque están del lado del real.
3. **Reuso masivo del schema existente**: clients, projects, profiles, project_members, tickets, notifications, audit_log — sin duplicar.
4. **Enriquecer el reporte de sprint** de `018`: hoy compara "estimadas vs entregadas" pero le falta "estimadas vs cargadas".

**Concepto nuevo introducido por esta feature: `Actividad`.** El PM define por proyecto una lista de actividades (`QA`, `Desarrollo`, `PM`, `Data Entry`, `Meeting`, etc.). Al cargar tiempo, el user elige una — sirve para cortar reportes por tipo de trabajo. Es análogo a "work attributes" de Tempo.

---

## 3. User stories

### Carga

- **US-1 · Cargar contra un ticket** — Como miembro `contributor+` de un proyecto, quiero cargar una entry contra un ticket con fecha, minutos, actividad y descripción opcional.
- **US-2 · Cargar sin ticket** — Como miembro, quiero cargar tiempo directamente contra un proyecto + actividad, sin tener que crear un ticket "Reunión" cada vez.
- **US-3 · Cronómetro** — Como colaborador, quiero un cronómetro que arranco desde cualquier lugar y paro cuando termino, para no cargar de memoria.

### Vista personal

- **US-4 · Mi Semana** — Como colaborador, quiero ver la semana con mis cargas en columnas por día (estilo TrackingTime), y navegar semana por semana.
- **US-5 · Editar mías** — Como autor, quiero editar/borrar mis entries de los últimos 7 días sin permiso.

### Administración

- **US-6 · Cargar por otros** — Como admin, PM o `lead` de un proyecto, quiero cargar por otra persona (cubrir olvidos).
- **US-7 · Editar ajenas (admin)** — Como admin, quiero editar/borrar entries de cualquiera sin límite temporal, para corregir cargas al ticket equivocado.
- **US-8 · Definir actividades del proyecto** — Como PM del proyecto, quiero agregar/editar/desactivar la lista de actividades que aplican a mi proyecto.

### Reportes

- **US-9 · Consumo** — Como admin o PM, quiero un reporte de horas cargadas Cliente > Proyecto > Persona en un rango, con filtros combinables.
- **US-10 · Plan-vs-real** — Como admin o PM, quiero comparar `sum(bookings.duration)` vs `sum(time_entries.minutos)` por (proyecto, persona, período) para detectar sub-carga o desvío.
- **US-11 · Export CSV** — Como admin, quiero bajar un CSV con todas las entries filtradas por rango, cliente, proyecto o persona.
- **US-12 · Sprint enriquecido** — Como PM, quiero que el reporte de sprint cerrado (018) sume "Horas cargadas" con la comparación estimado-vs-real.

### Rol

- **US-13 · Rol `staff`** — Como admin, quiero asignar el rol `staff` a personas de administración/comercial que cargan horas pero no son devs (no aparecen en el calendario como recurso reservable, no tienen Bandeja).

---

## 4. Acceptance criteria

### US-1 y US-2 · carga básica

- **AC-1.1** — Given un `contributor+` de un proyecto, when postea `POST /api/time-entries` con `project_id` (req), `activity_id` (req si el proyecto tiene actividades, ver AC-1.5), `ticket_id` (opcional), `minutes` (múltiplo de 15, > 0, ≤ 960), `logged_at` (date en zona local), `description` (opcional, max 500 chars), then se crea con `user_id = auth.uid()`, `created_by = auth.uid()`.
- **AC-1.2** — Si `ticket_id` está seteado, tiene que pertenecer al mismo `project_id`. La API rechaza con 400. Es un chequeo defensivo — la UI ya lo hace.
- **AC-1.3** — Si el `activity_id` está seteado, tiene que pertenecer al mismo `project_id` y estar `active = true`. Actividades desactivadas no aceptan cargas nuevas pero las viejas siguen visibles.
- **AC-1.4** — Un contributor que no es miembro del proyecto es rechazado por la RLS (`insert with check` mira `role_in_project`). La API traduce el silencio de la RLS a 403 explícito.
- **AC-1.5** — Given un proyecto **con al menos una actividad definida**, when se postea sin `activity_id`, then 400 con `reason: 'activity_required'`. Si el proyecto **no tiene ninguna actividad definida**, la carga va sin actividad — no bloquea al equipo el onboarding del proyecto.
- **AC-1.6** — Given `ticket_id` con proyecto `inactivo`, when se intenta cargar nueva entry, then 409 con motivo. Editar entries viejas de un proyecto inactivo sí se permite. Mismo patrón que bookings (D-08) y tickets (015 AC-2.5).
- **AC-1.7** — Sin `exclusion constraint` — se permiten solapamientos. Se carga duración, no franja horaria. Un dev puede tener 4h en `WDW-1` y 2h en `WDW-2` el mismo día sin restricción.
- **AC-1.8** — La descripción es **opcional**. Empty string (`""`) se guarda como `null`.

### US-3 · cronómetro

- **AC-3.1** — Given `POST /api/time-entries/timer/start` con `project_id`, `activity_id?`, `ticket_id?`, when la API valida (mismas reglas de AC-1.2/1.3), then inserta una fila en `active_timers(user_id = auth.uid(), project_id, activity_id, ticket_id, started_at = now())`. Solo hay una fila por `user_id` (PK).
- **AC-3.2** — Given un cronómetro activo sobre X, when el mismo user arranca otro sobre Y, then el de X **se detiene y se persiste primero** como time entry (AC-3.3), y el de Y arranca fresco. No se pierde tiempo.
- **AC-3.3** — Given `POST /api/time-entries/timer/stop`, then se calcula `minutes = round((now() - started_at) / 15min) * 15` (mínimo 15 min si `now - started_at > 0`), se inserta un `time_entry` con esos minutos y descripción vacía (editable después), se borra la fila de `active_timers`, y se devuelve `{ time_entry_id }` para navegación a "editar y describir". Atómico en una transacción.
- **AC-3.4** — Given un cronómetro corriendo hace más de 12h, when la UI lo muestra en el header, then aparece con badge de advertencia. **No se auto-detiene** — el dato no se pierde, la advertencia es visible.
- **AC-3.5** — Given la sesión del navegador se cierra con el cronómetro activo, when se vuelve a entrar, then sigue corriendo (estado en DB, no en localStorage) y el header lo muestra con tiempo transcurrido actualizado.
- **AC-3.6** — El cronómetro se ve **fuera de la ruta /my-time**: pill flotante en el header (arriba a la derecha del `AppShell`, al lado del `NotificationBell`) que muestra ticket/actividad y tiempo corriendo. Click abre el flujo de "parar y guardar".

### US-4 · Mi Semana

- **AC-4.1** — Given un colaborador entra a `/my-time`, when la vista carga, then muestra una grilla de 7 columnas (Lun–Dom de la semana actual). Cada columna tiene fecha (día, mes) y **total de horas** cargadas ese día (badge). Días sin cargar muestran `0`. Cada entry se renderiza como una **card apilada dentro de la columna**, ordenada por `created_at desc`.
- **AC-4.2** — Cada card muestra: `KEY` del ticket (si hay) o "Sin ticket" en muted, actividad, horas, descripción truncada. Hover muestra edit/delete si el viewer es autor o admin. Click en la card abre el ticket (si tiene) o el edit dialog (si no).
- **AC-4.3** — Botón `+ Cargar tiempo` abre un dialog con: proyecto (Select), actividad (Select, aparece cuando el proyecto tiene actividades), ticket (autocomplete opcional, filtrado a los del proyecto), fecha (date input, default hoy), minutos (input con múltiplos de 15), descripción (opcional). Click en una columna vacía del día pre-completa la fecha.
- **AC-4.4** — Navegación semanal: botones `<` `Esta semana` `>`. Semana viaja como `?w=YYYY-MM-DD` (lunes de esa semana). Sin param → semana actual del user (zona local).
- **AC-4.5** — Selector de usuario al lado de la navegación, **visible solo** para admin o PMs de al menos un proyecto. Default es "yo"; se puede cambiar a cualquier profile activo. Cuando se ve la semana de otro, un badge visual aclara "Viendo la semana de X". `?userId=<uuid>` en la URL.

### US-5 y US-7 · edición

- **AC-5.1** — Given una entry propia con `logged_at >= current_date - 7 days`, when `PATCH /api/time-entries/:id`, then update aplicado. Campos editables: `minutes`, `logged_at`, `description`, `activity_id`, `ticket_id`.
- **AC-5.2** — Given una entry propia con `logged_at` **más viejo** que 7 días, when el user (no admin) intenta editar, then 403 con `reason: 'edit_window_expired'`.
- **AC-5.3** — Given un admin edita cualquier entry (propia o ajena, fecha vieja o reciente), when hace el `PATCH`, then update aplicado. Escribe a `audit_log` con `entity = 'time_entry'`, `actor_id`, y el diff.
- **AC-5.4** — Given un `DELETE /api/time-entries/:id` con entry dentro de la ventana de 7 días (y del propio user) O el user es admin, then se borra físicamente. Escribe a `audit_log` con el payload pre-borrado. **Fuera de la ventana solo admin borra.**

### US-6 · cargar por otros

- **AC-6.1** — Given admin, PM del proyecto, o `lead` del proyecto, when postea `POST /api/time-entries` con `user_id` distinto de `auth.uid()`, then se crea con `user_id = valor pasado`, `created_by = auth.uid()`. `audit_log` lo registra.
- **AC-6.2** — Given un `contributor` intenta postear con `user_id ≠ auth.uid()`, when la API valida, then 403.
- **AC-6.3** — Given la persona objetivo abre `/my-time`, then ve la entry con badge "cargada por X" (fuente: `created_by ≠ user_id`). Puede editarla como cualquiera propia dentro de la ventana de 7 días.

### US-8 · actividades del proyecto

- **AC-8.1** — Given el workspace del proyecto, when el viewer es admin o PM primario, then aparece una tab **"Actividades"** que lista las actividades del proyecto con estado activo/inactivo.
- **AC-8.2** — Botón "Agregar actividad" abre dialog con nombre (text, 1-60 chars, único por proyecto). Al guardar, se crea con `active = true`. `POST /api/project-activities`.
- **AC-8.3** — Botón "Desactivar" cambia `active` a `false`. No se borra: entries viejas siguen apuntando. `PATCH /api/project-activities/:id`.
- **AC-8.4** — La lista de actividades del proyecto viaja al dialog de "Cargar tiempo" cuando el usuario elige ese proyecto. Solo las `active = true` aparecen en el Select — las desactivadas se muestran únicamente en entries viejas.

### US-9 · consumo

- **AC-9.1** — Given `/reports/consumo?from=YYYY-MM-DD&to=YYYY-MM-DD` (default: mes actual), when la vista carga, then muestra una tabla **Cliente > Proyecto > Persona** con `horas_cargadas` (sum de minutes/60) en el rango.
- **AC-9.2** — Filtros combinables en URL: `clientId`, `projectId`, `userId`. Sin filtros → todos los proyectos del alcance del viewer (admin todo; PM sus proyectos).
- **AC-9.3** — El reporte se puede pivotear por `groupBy=proyecto|persona|actividad`. Default: cliente → proyecto → persona.

### US-10 · plan-vs-real

- **AC-10.1** — Given `/reports/plan-vs-real?from=&to=` (default: mes actual), when la vista carga, then muestra una tabla agrupada Cliente > Proyecto > Persona con columnas: **horas_plan** (`sum(booking.end - booking.start)` con `status = approved`, `dev_id = person`, `project_id = project`, en el rango), **horas_real** (`sum(time_entries.minutes) / 60`), **delta** (`real - plan`), **%_completado** (`real / plan * 100`).
- **AC-10.2** — Si `plan > 0` y `real = 0`: "plan sin real" (compromiso incumplido). Si `plan = 0` y `real > 0`: "real sin plan" (trabajo no anticipado).
- **AC-10.3** — El reporte es puramente derivado (dos queries agregadas), sin materialización. Un cambio en un booking o entry se refleja al recargar.

### US-11 · export CSV

- **AC-11.1** — Given `GET /api/time-entries/export.csv?from=&to=&clientId?=&projectId?=&userId?=`, when el user tiene alcance a las entries pedidas, then responde `text/csv` con columnas: `fecha`, `user_email`, `user_nombre`, `client`, `project`, `ticket_key`, `ticket_title`, `activity`, `minutos`, `horas`, `descripcion`, `created_by`.
- **AC-11.2** — El export respeta alcance de permisos del viewer (admin todo; PM sus proyectos). Un `contributor` no accede al export (403).

### US-12 · sprint enriquecido

- **AC-12.1** — El reporte de sprint cerrado (`/projects/[key]/sprints/[N]` de 018) suma una sección **"Horas cargadas"** con: `total_cargado` (sum de entries sobre tickets del sprint, `logged_at` entre `starts_at` y `closed_at::date`), breakdown por asignado, y comparación estimado vs cargado (**Estimadas: 40hs · Cargadas: 45.5hs · Desvío: +14%**).
- **AC-12.2** — La sección se calcula **live-queried**, no vive en el snapshot. Motivo: es común cargar tarde (viernes olvidado, lunes se carga). Si viviera congelada, se perderían esas entries retroactivas. Nota al pie: "Horas cargadas: calculadas al momento de abrir esta página".

### US-13 · rol staff

- **AC-13.1** — El enum `user_role` gana `staff`. Los profiles con este rol pueden ser miembros de proyectos y cargar horas, pero **no aparecen** en el calendario como recurso reservable (`bookings.dev_id` sigue exigiendo `hasRole('developer')`).
- **AC-13.2** — En `/admin/users`, el checkbox de roles suma `Staff`. `has_role('staff', user_id)` funciona en la base como los otros.
- **AC-13.3** — Un profile con `{staff}` solo (sin developer/pm) no ve Bandeja (`/inbox`), ve Mi Trabajo, Mi Tiempo, Calendario (lectura, como cualquiera). El sidebar suma un ítem "Mi Tiempo" visible para todos autenticados.

---

## 5. Alcance

**Dentro:**
- Nuevo valor `staff` en enum `user_role`.
- Tabla `project_activities (id, project_id, name, active, created_at)` con unique parcial `(project_id, name) where active = true`.
- Tabla `time_entries (id, user_id, created_by, project_id, ticket_id null, activity_id null, minutes, logged_at, description null, created_at, updated_at)`.
- Tabla `active_timers (user_id PK, project_id, activity_id null, ticket_id null, started_at)`.
- Triggers: audit para `time_entries`, `active_timers`, `project_activities`. Rate-limiting no; minutes constraint.
- API: `POST/PATCH/DELETE /api/time-entries`, `POST /api/time-entries/timer/start`, `POST /api/time-entries/timer/stop`, `POST/PATCH /api/project-activities`, `GET /api/time-entries/export.csv`.
- Vistas: `/my-time` (grilla semanal), `/reports/consumo`, `/reports/plan-vs-real`, sección "Horas cargadas" en `/tickets/[key]`, tab "Actividades" en `/projects/[key]/activities`.
- Header: pill flotante del timer activo, siempre visible cuando corre.
- Sidebar: ítem "Mi Tiempo" para todos autenticados; ítem "Reportes" para admin y PMs de al menos un proyecto.
- Enriquecimiento del reporte de sprint (018) con sección "Horas cargadas" live-queried.
- Notificaciones (patrón 010): `time_entry_created_by_other` (cuando alguien carga por vos), `time_entry_deleted_by_admin` (cuando admin te borra una entry).
- `audit_log` para create/update/delete de `time_entries`, `active_timers`, `project_activities`.

**Fuera (explícito):**
- **Todo lo monetario**: `valor_hora`, `moneda`, `costo_hora_interno`, valorización, facturación, tarifas. No entra en este slug ni en el próximo. Si algún día se necesita, se suma como columnas nullable a `time_entries` sin schema breaking.
- **Cupos mensuales por proyecto** (`project_quotas`). No en MVP.
- **Ausencias, vacaciones, feriados, licencias.** Los reportes "días sin carga" no se implementan porque no distinguen vacaciones.
- **Reporte "días sin carga por persona".** No incluido. Se puede agregar cuando duela.
- **`bookings.ticket_id`.** Descartado — se deja bookings como está. Plan-vs-real se agrupa por (proyecto × persona × período), no ticket a ticket.
- **Cliente/Proyecto "interno" sembrado por migration.** Se descarta. Si el equipo necesita un proyecto interno, lo crea admin manualmente.
- **Import histórico de TrackingTime.** Fuera del MVP. Si se requiere migrar el historial, se resuelve con un script one-off contra `service_role`.
- **Aprobación de horas por supervisor / cierre de mes contable.** El `audit_log` es la disciplina.
- **Rentabilidad, costos.** Fase futura.
- **Sincronización con Slack (reminder de viernes) / Jira externo.** Fuera; se integra cuando aterricen `009` y `008`.

---

## 6. Preguntas — todas cerradas

Las 14 preguntas del cuestionario en tres rondas quedaron cerradas antes de escribir esta spec:

- Actividades: **texto libre por proyecto**.
- Sin ticket: **sí**, contra proyecto + actividad.
- Cronómetro: **sí**, persistido en DB.
- Rol `staff`: **sí**.
- UX Mi Semana: **columnas por día + cards apiladas** (estilo TrackingTime).
- Duración: **minutos, múltiplos de 15**.
- Ventana de edición: **7 días** para users; admin sin límite.
- Cupos: **no en MVP**.
- Descripción: **opcional**.
- Reportes: **consumo + plan-vs-real + export CSV**. Sin "días sin carga".
- `bookings.ticket_id`: **no**.
- Ausencias: **fuera del MVP**.
- Actividad obligatoria: **si el proyecto tiene actividades definidas**. Sin actividades definidas → se puede cargar sin.
- Acceso a Reportes: **admin y PMs de al menos un proyecto**.

---

## 7. Riesgos

- **R-1 · DELETE en `authenticated`** — primera vez que la app expone DELETE. Un contributor puede borrar su propia entry dentro de la ventana de 7 días. **Mitigación:** confirmación en UI, `audit_log` conserva el payload pre-borrado. Un admin puede restaurar leyendo la fila de audit y reinserta manualmente si fuese necesario.
- **R-2 · Actividades como texto libre por proyecto** — dos proyectos con `QA` son strings distintos. Reportes cross-proyecto agrupan por `activity.name` con matching de string (case-insensitive por convención); si un proyecto usa "QA" y otro "Testing", quedan separados. **Aceptable** en MVP; si duele, se migra a lista global con habilitación por proyecto (opción A del cuestionario), y las migrations quedan lineales.
- **R-3 · Timer huérfano post-fin de semana** — alguien arranca timer viernes 18h, llega lunes 9h con 63h corridas. **Mitigación:** badge de advertencia desde 12h visible en el header. Al parar, el user edita a mano los minutos. No se auto-detiene — el dato nunca se pierde.
- **R-4 · Descripción opcional degrada reportes** — sin descripción, "5hs en Ticket X" no dice qué se hizo. **Mitigación cultural**, no técnica. Si el equipo pide obligatoriedad, se cambia AC-1.8 en una iteración.
- **R-5 · Doble timer en dos dispositivos** — una fila por `user_id` (PK). Ambos dispositivos leen la misma fila; solo uno "corre" en el modelo aunque los dos muestren pill. Parar desde cualquiera persiste una vez.
- **R-6 · Zona horaria** — `logged_at` es `date` (no `timestamptz`) para evitar el clásico "cargué el 15, se guardó como 14 por UTC". El cliente manda ISO string (`2026-09-16`); la base lo guarda tal cual. La UI usa la fecha del navegador para default.
- **R-7 · Migration 17 con enum extendido** — agregar `staff` al enum `user_role` es una operación no-destructiva pero requiere `alter type` que en Postgres 15 puede ser lento con muchas filas dependientes. Con el volumen actual (menos de 20 profiles), es instantáneo.
- **R-8 · Plan-vs-real con dos fuentes de verdad** — bookings dice "prometí 4h el jueves"; time_entries dice "cargué 3h el jueves"; ¿sub-carga o ticket equivocado? **Mitigación:** el reporte agrupa por (proyecto × persona × período), no exige match ticket-a-booking. El delta es orientativo, no acusatorio. La doc del reporte explica la semántica.
- **R-9 · Actividades desactivadas y entries viejas** — desactivar una actividad no borra la referencia. Reportes que agrupan por `activity_id` siguen mostrando la actividad (con su name histórico, aunque `active = false`). En UI se marca "desactivada" para que el user sepa.

---

## 8. Dependencias

- **015** — tickets, membresías, RLS por proyecto.
- **012** — enum `user_role` (se le agrega `staff`).
- **010** — infraestructura de notificaciones (patrón trigger + dispatch).
- **018** — el reporte de sprint se enriquece. No es dependencia dura; si 018 no existiera, 016 funciona igual.
- **NO depende** de 007/008/009 (integraciones).

---

## 9. Compatibilidad con features futuras

- **Plata / valorización** — si mañana el negocio pide facturar, se suman columnas nullable (`valor_hora_aplicado`, `moneda`) a `time_entries` sin schema breaking. Los reportes se actualizan.
- **Cupos** — tabla `project_quotas(project_id, period, min, max)` con unique `(project_id, period)`. Sin dependencia con time entries.
- **Slack reminder de viernes** — cuando aterrice `009`, un cron corre viernes y usa una query de entries para armar el mensaje "estas personas no cargaron esta semana". No requiere cambios a este slug.
- **Import histórico de TrackingTime** — script one-off contra `service_role`; usa las mismas APIs.
- **Aprobación de horas / cierre contable** — se puede agregar un `sending_state` o `approved_at` a `time_entries` sin romper lo existente.
