# Spec — Time tracking

- **ID:** 016-time-tracking
- **Estado:** draft
- **Referencias en la spec funcional:** § nueva (módulo TT); complementa §4 (calendario), §11 (roles). Basado en el análisis previo "Plataforma de Time Tracking (MVP) v0.1" de Nico (WeDo Web).

---

## 1. Objetivo

Que las personas de WeDo Web carguen sus horas reales contra tickets locales (creados en `015`) y que los socios respondan sin abrir una planilla las tres preguntas de negocio: cuántas horas consumió cada proyecto vs. lo comprometido, cuánto vale en plata, y quién está cargando y quién no. El diferencial sobre cualquier tracker externo es el **reporte plan-vs-real** — comparar `bookings` (compromiso) con `time_entries` (realidad) dentro del mismo producto.

---

## 2. Contexto

Hoy WeDo Web usa **Tracking Time** (plataforma externa). El módulo la reemplaza. La motivación específica de armarlo dentro de DevsCalendar y no cablear un tracker externo:

1. **Los `time_entries` apuntan a tickets locales** (`015`). Sin tickets propios, el time tracker se degrada a "horas contra un texto libre", que es lo que ya existe afuera.
2. **Plan-vs-real**: `bookings.duration` (aprobado) vs. `sum(time_entries.minutos)` en el mismo período. Ningún Jira/Toggl/Harvest lo hace porque están del lado del real solamente. Es la razón operativa para tener las dos cosas juntas.
3. **Reuso masivo del schema existente**: `clients`, `projects`, `profiles`, `project_members` (de `015`), `tickets` (de `015`), `audit_log` (de `010`), `notifications` (de `010`). Ninguna se duplica; algunas se extienden.

Lo que **sí** trae este slug al schema:

- **Extensiones** de `clients` (`tipo`, `moneda`), `projects` (`modalidad`, `valor_hora_default`, `moneda`, fechas), `project_members` (`valor_hora_override`), `profiles` (`costo_hora_interno` — nullable, solo admin).
- **Nuevo rol `staff`** en el enum de `roles` (para administración/comercial: cargan sus horas, no son devs ni PMs).
- **Tablas nuevas**: `time_entries`, `active_timers`, `project_quotas`.
- **Cliente `interno`** (WeDo Web) obligatorio, sembrado por migration, para imputar horas no facturables.
- **Columna `estimacion_horas`** en `tickets` — sacada del alcance de `015` porque solo la usa este módulo (regla de "no agregar sin caso concreto").
- **Columna opcional `bookings.ticket_id`** — un PM puede asociar una reserva a un ticket ya existente. Nullable, no obliga. La confluencia se pidió en la charla previa.

---

## 3. User stories

- **US-1** — Como colaborador (dev, staff, PM o admin, con `active = true`), quiero cargar una hora contra un ticket con fecha, duración y descripción, para reportar mi tiempo diario.
- **US-2** — Como colaborador, quiero un cronómetro que arranco y paro, para generar un `time_entry` sin escribirlo a mano.
- **US-3** — Como colaborador, quiero ver **Mi Semana** (grilla 7 días × tickets con totales por día y semana), para saber qué cargué y qué falta. Tiene que funcionar bien en el celular.
- **US-4** — Como colaborador, quiero editar mis entries dentro de los últimos 7 días, para corregir errores sin pedir permiso.
- **US-5** — Como admin (o PM/lead del proyecto), quiero cargar horas por otra persona en proyectos donde tengo permiso, para cubrir olvidos.
- **US-6** — Como admin/PM, quiero ver el consumo del mes por proyecto contra su cupo (horas y montos), para saber si un retainer se está pasando o quedando corto.
- **US-7** — Como admin/PM, quiero el reporte **plan-vs-real** —bookings comprometidos vs. horas cargadas por proyecto y persona en un rango—, para detectar sub-carga o desvío entre lo prometido y lo entregado.
- **US-8** — Como admin, quiero un reporte de días sin carga por persona en un rango, para detectar el agujero que rompe todos los reportes.
- **US-9** — Como admin, quiero exportar los registros crudos a CSV con todos los campos, para operaciones offline y facturación.
- **US-10** — Como admin, quiero configurar tarifas: `valor_hora_default` por proyecto y `valor_hora_override` por asignación persona-proyecto, para que los reportes valoricen sin scripts.
- **US-11** — Como admin, quiero configurar cupos mensuales (min/max) para proyectos retainer, para que el reporte de consumo diga "va bien" o "se está pasando".

---

## 4. Acceptance criteria

### US-1 · Carga básica

- **AC-1.1** — Given un colaborador activo, when postea a `POST /api/time-entries` con `ticket_id`, `fecha` (día calendario en zona `America/Argentina/Buenos_Aires`), `minutos` (entero, múltiplo de 15, `>0` y `≤ 960`), `descripcion` (texto, ver AC-1.5), then el `time_entry` se crea con `user_id = auth.uid()`, `created_by = auth.uid()`, y `valor_hora_aplicado` + `moneda_aplicada` **congelados** según la cascada (AC-11).
- **AC-1.2** — Given un colaborador intenta cargar sobre un ticket cuyo proyecto no es miembro (y no es admin), when postea, then la API responde `403`.
- **AC-1.3** — Given un colaborador carga en un día `fecha < current_date - interval '7 days'`, when postea, then la API responde `403` con motivo "fuera de la ventana de 7 días". Un admin puede cargar en cualquier fecha (chequeo `is_admin()` bypassea la ventana).
- **AC-1.4** — Given un colaborador carga múltiples entries sobre el mismo día que suman `> 960` minutos (16h), when postea el que supera, then la API responde `400` con motivo. El límite es de tipeo, no política laboral; se puede subir si aparece un caso legítimo.
- **AC-1.5** — Given el ticket pertenece a un proyecto con `facturable_default = true` (i.e. proyecto de un cliente no-`interno`), when se guarda el entry sin `descripcion` o con `descripcion.length < 10`, then la API responde `400`. Para proyectos `interno`, la descripción es **opcional** (mitigación de fricción diaria — R-1).
- **AC-1.6** — Given el ticket pertenece a un proyecto con `estado = 'inactivo'`, when se intenta cargar, then la API responde `409`. Editar entries viejos de un proyecto ya desactivado sí se permite; alta nueva no. Mismo patrón que bookings (D-08, `013`) y que tickets (AC-2.5 de `015`).
- **AC-1.7** — Se permiten **solapamientos** horarios entre entries. Se carga duración, no franja: `time_entries` no tiene `start_time`/`end_time`. Un dev puede tener 4h en `WDW-1` y 2h en `WDW-2` en el mismo día sin restricción; no hay `exclusion constraint` como bookings.

### US-2 · Cronómetro

- **AC-2.1** — Given un colaborador postea a `POST /api/time-entries/timer/start` con `ticket_id`, when la API valida, then inserta una fila en `active_timers(user_id = auth.uid(), ticket_id, started_at = now())`. Solo hay una fila por `user_id` (PK); si ya existía, la vieja **se detiene y se persiste** primero (AC-2.3).
- **AC-2.2** — Given un cronómetro activo, when `POST /api/time-entries/timer/stop`, then se calcula `duracion_min = round((now() - started_at) / 15min) * 15`, se inserta un `time_entry` con `descripcion = ''` (editable después) y `minutos = duracion_min`, se borra la fila de `active_timers`, y se devuelve el `time_entry_id` para navegación a "editar y describir". Todo atómico en una transacción.
- **AC-2.3** — Given un cronómetro activo sobre `WDW-1`, when el mismo user arranca otro sobre `WDW-2`, then el de `WDW-1` **se detiene y se persiste** con el flujo de AC-2.2, y el de `WDW-2` arranca fresco. No se pierde tiempo.
- **AC-2.4** — Given un cronómetro está corriendo hace más de 12h, when la UI lo muestra, then aparece con un badge de advertencia "cronómetro corriendo hace más de 12h — puede que lo hayas dejado prendido". **No se auto-detiene**; el dato no se pierde nunca, la advertencia es visible.
- **AC-2.5** — Given la sesión del navegador se cierra con el cronómetro activo, when se vuelve a entrar, then el cronómetro sigue corriendo (state está en la DB, no en el navegador) y el header lo muestra con el tiempo transcurrido actualizado.

### US-3 · Mi semana

- **AC-3.1** — Given un colaborador entra a `/mi-semana`, when la vista carga, then muestra una grilla con 7 columnas (lunes → domingo de la semana actual) y filas por ticket cargado esa semana. Cada celda muestra los minutos cargados; el total por día está en el header y el total de la semana en el footer.
- **AC-3.2** — La vista se navega semana a semana con `?week=YYYY-MM-DD` (fecha del lunes). Sin param → semana actual. Patrón coherente con `src/lib/calendar/url.ts`.
- **AC-3.3** — Los últimos 5 tickets usados por el colaborador aparecen destacados en el selector de "cargar hora", ordenados por `max(time_entries.updated_at)` de ese user.
- **AC-3.4** — La vista es Server Component; la carga inline por celda es Client Component. El breakpoint móvil hace scroll horizontal en la grilla y cambia el foco a un formulario compacto "día actual + ticket + duración + guardar", porque **la mitad de las cargas van a pasar desde el celular** (R-1).

### US-4 · Edición dentro de 7 días

- **AC-4.1** — Given un colaborador edita su entry cuyo `fecha >= current_date - interval '7 days'`, when hace `PATCH /api/time-entries/:id`, then el update se aplica. Se puede cambiar `ticket_id`, `minutos`, `descripcion`, `facturable`; `valor_hora_aplicado` y `moneda_aplicada` **no se recalculan** (AC-11.5).
- **AC-4.2** — Given una entry con `fecha` **más allá** de la ventana, when un colaborador (no admin) intenta editar, then la API responde `403` con motivo.
- **AC-4.3** — Given un admin edita cualquier entry (propia o ajena, fecha vieja o reciente), when hace el `PATCH`, then el update se aplica y queda registrado en `audit_log` con `entity = 'time_entry'`, `actor_id`, `payload` con el diff.
- **AC-4.4** — Given un colaborador borra su entry (`DELETE /api/time-entries/:id`), when la entry está dentro de la ventana de 7 días, then se borra físicamente (no hay concepto de "cancelada" — las horas cargadas por error no son historia útil). El borrado escribe una fila en `audit_log` con el payload completo pre-borrado. **Fuera de la ventana solo borra admin.**

### US-5 · Carga por otros

- **AC-5.1** — Given un admin (o PM del proyecto, o miembro `lead` del proyecto), when postea `POST /api/time-entries` con `user_id` distinto de `auth.uid()`, then el entry se crea con `user_id` = valor pasado y `created_by = auth.uid()`. Se registra en `audit_log`.
- **AC-5.2** — Given un `contributor`/`viewer`/`developer sin membresía` intenta postear con `user_id` distinto del propio, when la API valida, then responde `403`.
- **AC-5.3** — Given un admin/PM/lead carga por otro, when la persona objetivo abre `/mi-semana`, then ve la entry con un flag visual "cargada por Juan" (fuente: `created_by != user_id`). Puede editarla como cualquier entry propia dentro de la ventana de 7 días.

### US-6 · Consumo vs cupo

- **AC-6.1** — Given un admin/PM abre `/reports/consumo?period=YYYY-MM`, when la vista carga, then lista proyectos activos con su `modalidad`. Para cada proyecto muestra:
  - `horas_cargadas` (sum de `time_entries.minutos / 60` de ese mes, `facturable = true`).
  - `horas_min` y `horas_max` del `project_quotas` de ese mes; si no existe, se toma la plantilla en `projects.retainer_horas_min` / `.retainer_horas_max`.
  - Una barra visual con el consumo entre min y max, coloreada según estado.
  - `valor_total` = suma de `time_entries.minutos * valor_hora_aplicado / 60`, agrupado por moneda (mostrar filas separadas ARS y USD — sin consolidar, coherente con la decisión de Q-2).
- **AC-6.2** — Given un proyecto con `al_superar_max = 'bloquear_carga'`, when un colaborador intenta cargar minutos que llevarían el mes por encima de `horas_max`, then la API responde `409` con motivo "cupo mensual alcanzado". Con `al_superar_max = 'avisar'`, el post pasa y la UI muestra un warning visible sobre la próxima carga.
- **AC-6.3** — Given el cierre del mes calendario (T+7 días, ver métrica), when un proyecto quedó por debajo de `horas_min`, then aparece marcado con badge "sub-consumo" en el reporte del mes anterior. Es informativo, no bloqueante.
- **AC-6.4** — Un proyecto con `modalidad = 'bolsa_horas'` no usa `project_quotas`: en lugar de min/max mensual, tiene `projects.bolsa_horas_total`. El reporte lo muestra como "consumido / total" acumulado desde la fecha de inicio del proyecto. Proyectos `precio_cerrado` y `time_and_materials` no tienen cupo y se muestran solo con las horas cargadas y su valor.

### US-7 · Plan-vs-real

- **AC-7.1** — Given un admin/PM abre `/reports/plan-vs-real?from=YYYY-MM-DD&to=YYYY-MM-DD` (default: mes actual), when la vista carga, then muestra una tabla agrupada Cliente > Proyecto > Persona con las columnas:
  - `horas_plan` = `sum(booking.end - booking.start)` de bookings con `status = 'approved'`, `dev_id = person`, `project_id = project`, en el rango.
  - `horas_real` = `sum(time_entries.minutos) / 60` de entries con `user_id = person`, `ticket_id.project_id = project`, en el rango.
  - `delta` = `real - plan` (horas).
  - `%_completado` = `real / plan * 100` si `plan > 0`; si `plan = 0` y `real > 0`, se muestra "real sin plan" (trabajo no anticipado). Si `plan > 0` y `real = 0`, "plan sin real" (compromiso incumplido).
- **AC-7.2** — La vista soporta filtros combinables en URL: `clientId`, `projectId`, `userId`, `from`, `to`. Sin filtros → todos los proyectos del usuario según su alcance de permisos (admin ve todo, PM ve sus proyectos, lead ve los propios).
- **AC-7.3** — El reporte respeta la visibilidad de montos: solo admin y PM del proyecto ven las columnas `$_plan` y `$_real` (calculadas con la misma cascada de tarifas). Otros ven solo horas.
- **AC-7.4** — El reporte es **puramente derivado** (dos queries agrupadas) y no persiste nada. Un cambio en un booking o en un entry se refleja al recargar. No hay materialized view en el MVP (regla del análisis previo §7: "no diseñar para escala"; 6 personas, ~250 entries/mes).

### US-8 · Días sin carga

- **AC-8.1** — Given un admin abre `/reports/dias-sin-carga?from=…&to=…`, when la vista carga, then lista personas activas con roles `developer`, `staff` o `pm` y muestra la lista de días laborables (lunes-viernes) del rango donde `sum(time_entries.minutos) = 0` para esa persona. Los feriados no se contemplan en el MVP (fuera de alcance según el análisis previo §1).
- **AC-8.2** — La vista tiene un filtro `userId` opcional; sin él, muestra el equipo completo.

### US-9 · Export CSV

- **AC-9.1** — Given un admin/PM abre `/reports/export?from=…&to=…&clientId=…&projectId=…&userId=…`, when solicita el CSV, then el endpoint `GET /api/time-entries/export.csv` responde con un stream CSV con las columnas: `fecha`, `user_email`, `user_nombre`, `client`, `project`, `ticket_key`, `ticket_title`, `minutos`, `horas`, `descripcion`, `facturable`, `valor_hora_aplicado`, `moneda_aplicada`, `total`, `created_by`.
- **AC-9.2** — El export respeta el alcance de permisos del usuario que lo pide (admin todo; PM/lead solo sus proyectos). Un colaborador que se exporte a sí mismo obtiene solo sus entries sin las columnas de valor.

### US-10 · Tarifas y valor congelado

- **AC-10.1** — La cascada de resolución de tarifa al crear un `time_entry` es:
  1. `project_members.valor_hora_override` para el par (proyecto del ticket, `user_id` del entry) si `!= null`.
  2. `projects.valor_hora_default` del proyecto del ticket si `!= null`.
  3. Sin tarifa: el entry se guarda con `valor_hora_aplicado = null` y aparece marcado como "sin tarifa" en los reportes.
- **AC-10.2** — El `time_entry` guarda **también** `moneda_aplicada` (`ARS` o `USD`), copiada de `projects.moneda` en el momento de la carga.
- **AC-10.3** — Given un admin cambia `valor_hora_default` de un proyecto en marzo, when se abre el reporte de febrero, then los valores mostrados son los **originales** de las cargas de febrero. Sin joins: los reportes leen `valor_hora_aplicado` directo de `time_entries`.
- **AC-10.4** — Given un admin cambia `valor_hora_override` de una asignación, when hay entries viejos, then los viejos **no se recalculan**. Nuevas cargas usan el nuevo override.
- **AC-10.5** — El endpoint de edit (`PATCH /api/time-entries/:id`) **no reevalúa la tarifa**. Si un admin necesita corregir la tarifa histórica, es una operación explícita (endpoint separado `PATCH /api/time-entries/:id/recompute-rate`, solo admin, con `audit_log`). Fuera del MVP: se documenta como decisión.

### US-11 · Cupos y visibilidad de montos

- **AC-11.1** — Given un admin abre el detalle de un proyecto `retainer` en `/admin/projects/:id`, when la vista carga, then muestra una sección "Cupos mensuales" con los últimos 12 meses. Cada mes puede tener una fila explícita en `project_quotas` (override) o quedar en blanco → se aplica la plantilla `projects.retainer_horas_min/max`.
- **AC-11.2** — El admin puede insertar/editar una fila de override para cualquier mes futuro o pasado. El insert/edit escribe a `audit_log`.
- **AC-11.3** — La visibilidad de montos se rige por:
  - Admin: ve todo.
  - PM del proyecto (`projects.pm_id = auth.uid()`) o miembro `lead`: ve montos de su proyecto.
  - Miembro `contributor` o `viewer`: **no** ve montos ni tarifas.
  - No-miembro: no ve el proyecto para nada.

---

## 5. Alcance

### Dentro

- Extensiones de `clients` (`tipo enum('white_label','directo','interno')`, `moneda enum('ARS','USD')`, defaults conservadores para filas existentes con banner en admin para revisar).
- Extensiones de `projects` (`modalidad enum('retainer','bolsa_horas','precio_cerrado','time_and_materials')`, `valor_hora_default numeric(10,2)`, `moneda enum` heredable de client, `fecha_inicio date`, `fecha_fin date`, `bolsa_horas_total numeric(6,2)`, `retainer_horas_min numeric(6,2)`, `retainer_horas_max numeric(6,2)`, `facturable_default bool default true`, `al_superar_max text default 'avisar'`).
- Extensión de `project_members` (`valor_hora_override numeric(10,2) null`).
- Extensión de `profiles` (`costo_hora_interno numeric(10,2) null` — solo admin lo ve; no se usa en MVP pero se persiste desde el día uno para habilitar rentabilidad en fase 2 sin recalcular).
- Extensión de `tickets` (`estimacion_horas numeric(5,2) null` — sale de `015`, entra acá).
- Extensión de `bookings` (`ticket_id uuid null references tickets(id) on delete set null`).
- Rol nuevo `staff` en el enum de `roles`, helper `isStaff()` en `@/lib/auth/roles`, `has_role('staff', …)` en la base.
- Tabla `time_entries` con RLS: `select` según membresía + `is_admin()`; `insert`/`update`/`delete` según reglas AC-1 a AC-5. `audit_log` por trigger.
- Tabla `active_timers(user_id primary key, ticket_id, started_at)` con RLS: solo el dueño la ve/edita.
- Tabla `project_quotas(project_id, period date, horas_min, horas_max, al_superar_max)` con unique `(project_id, period)`.
- Migration siembra el cliente `interno` (nombre "WeDo Web (interno)", `tipo = 'interno'`, `moneda = 'ARS'`, `facturable_default = false` en sus proyectos).
- Vistas: `/mi-semana`, `/reports/consumo`, `/reports/plan-vs-real`, `/reports/dias-sin-carga`, `/reports/export` (endpoint CSV).
- ABM de tarifas por asignación (`valor_hora_override`) integrado al panel de miembros del proyecto (que ya existe en `015`).
- ABM de cupos mensuales integrado al detalle de proyecto en `/admin/projects/:id`.
- Header con cronómetro global: pill que muestra el timer activo, permite parar desde cualquier ruta.
- Notificaciones opcionales (dos tipos, mismo trigger-pattern de `010`):
  - `time_entry_assigned_by_other` — cuando alguien carga horas por vos.
  - `time_entry_deleted_by_admin` — cuando un admin borra una entry tuya.
  Se dejan como **fase 2 chica dentro de este slug** si el esfuerzo cabe; si aprieta el scope, se cortan y quedan para `018`.

### Fuera (explícito)

- **Cierre de período / `bloqueado`**: sin cierre de mes. La disciplina la lleva `audit_log`. Confirmado en la charla previa.
- **Aprobación de horas por un supervisor**: fase 2 del análisis previo.
- **Facturación / comprobantes**: fase 2.
- **Rentabilidad real**: la columna `costo_hora_interno` se agrega, pero el reporte que la usa es fase 2.
- **Sincronización con Jira externo**: fuera (existe `008-jira-integration` como slug separado para eso).
- **Acceso de clientes al reporte**: fuera.
- **Licencias, vacaciones, feriados**: fuera. Los reportes de "días sin carga" cuentan lunes-viernes secos, sin excepciones.
- **Consolidación de monedas**: los reportes muestran ARS y USD en filas separadas. No hay tasa de cambio ni conversión.
- **Slack reminder de días sin cargar**: fuera de `016`. Se enchufa cuando aterrice `009-slack-integration`, con un cron que corre viernes y usa el reporte de días sin carga.
- **Import de horas históricas de Tracking Time**: fuera del MVP. Si la migración es imprescindible, se resuelve con un script one-off que respete la cascada de tarifas y escriba con `service_role`.
- **Auto-generación mensual de `project_quotas`**: no hay cron. Los quotas son solo overrides sobre la plantilla en `projects.retainer_horas_min/max` — sin fila explícita, aplica la plantilla. Reduce moving parts.
- **Feriados y calendarios laborables por país**: fuera. Todo en `America/Argentina/Buenos_Aires`, lunes-viernes seco.

---

## 6. Dependencias

- **Features previas necesarias:** `015-project-membership-and-tickets` (tickets y membresía), `010-notifications-and-audit` (para los dos avisos opcionales y `audit_log`), `012-multiple-roles-and-active-enforcement` (roles set + `active`), `001-auth-and-permissions`.
- **Externas:** ninguna. Slack y GitHub se conectan más tarde (`009`, `017`).
- **Datos maestros:** todos los `projects` que van a recibir carga deben tener `modalidad` y (para retainer) `retainer_horas_min/max` cargados. La migration setea defaults conservadores (`modalidad = 'time_and_materials'`, `moneda = client.moneda`) para no bloquear; los admins revisan proyecto por proyecto en el ABM antes de que el equipo empiece a cargar.

---

## 7. Preguntas abiertas

- **Q-1** — El cliente `interno` de la migration: ¿nombre exacto y proyectos que lo pueblan? El análisis previo sugiere "Comercial", "Administración", "Infra", "Capacitación". **Recomendación por defecto:** la migration siembra el cliente "WeDo Web (interno)" y **un solo** proyecto `Interno General`. Los otros los crea admin manualmente. **Bloquea:** no.
- **Q-2** — PMs viendo montos de proyectos ajenos: en el análisis previo aparecía como "⚠️ configurable". **Recomendación por defecto:** no configurable en `015/016`. Un PM ve montos **solo** de sus proyectos (`projects.pm_id = auth.uid()` o `lead` en `project_members`); montos de proyectos ajenos son admin-only. **Bloquea:** no.
- **Q-3** — Descripción obligatoria para entries `facturable = false` sobre proyectos **no** `interno` (ej. horas no facturables dentro de un cliente directo). **Recomendación por defecto:** obligatoria (la regla es "obligatoria en proyectos con `facturable_default = true`", independiente del `facturable` de la entry particular). **Bloquea:** no.
- **Q-4** — Al eliminar un miembro de un proyecto (baja de `project_members.active = false`), ¿se pierde el acceso a **editar** las entries viejas que cargó? **Recomendación por defecto:** sí, la edición pasa a ser admin-only para esa persona; **leer** las propias entries sigue funcionando (`user_id = auth.uid()` alcanza para lectura en `time_entries`). **Bloquea:** no.
- **Q-5** — Reportes: ¿replicar exactamente el look/columnas de Tracking Time actual, o rediseñar? El pedido fue "similares". **Recomendación por defecto:** exportar 2–3 reportes de TT actual y anexarlos al `plan.md` como referencia. **Bloquea:** parcialmente el `plan.md`, no la spec.
- **Q-6** — `bookings.ticket_id`: ¿nace **null** para todos los bookings previos (backfill nulo), o intentamos matchear por proyecto? **Recomendación por defecto:** null. No hay heurística confiable para adivinar el ticket. **Bloquea:** no.
- **Q-7** — Auto-detención de timers: mencionado en AC-2.4 como "advertencia, no auto-stop". ¿Suficiente? Alternativa: auto-stop pasadas 24h con un flag `auto_stopped = true` en el entry. **Recomendación por defecto:** no auto-stop; solo advertencia visual. La disciplina se resuelve con UI, no con lógica automática. **Bloquea:** no.
- **Q-8** — Import de horas históricas de TT: ¿realmente cero, o hay que preparar terreno? **Recomendación por defecto:** cero. Se corta en la fecha de switch-over. Si aparece requerimiento, es un script one-off (fuera del MVP). **Bloquea:** no.

---

## 8. Métricas de éxito

- **Adopción diaria:** ≥90% de las personas activas cargan ≥1 hora cada día laborable, medido en la primera semana del segundo mes de uso (después del período de aprendizaje). Es el indicador que decide si la plataforma "funciona" o vuelve a ser una planilla.
- **Cobertura del mes:** ≥95% de las horas comprometidas en bookings tienen entry correspondiente (o justificación) al día 7 del mes siguiente.
- **Cero incidentes de tarifa cambiada retroactivamente:** en dos meses de operación, ningún reporte histórico devuelve un valor distinto al que devolvió al momento de generarse la primera vez. Auditable.
- **Reportes: los tres del análisis previo (§1)** se contestan desde la UI en <2 s: horas por proyecto vs cupo, valorización, personas cargando/no cargando.

---

## 9. Riesgos conocidos

- **R-1 — Adopción diaria.** Copiado del análisis previo §9: el riesgo real no es técnico. Cargar de memoria al fin del mes produce datos peores que no tener sistema. **Mitigación:** Mi Semana como home mobile-first, últimos tickets primero, cronómetro persistido en DB (sobrevive al cierre del navegador), notificación in-app cuando otra persona carga por vos, y —en `009` cuando aterrice— reminder de Slack los viernes.
- **R-2 — Rate freeze bugs.** El error clásico: reportes que joinean con el proyecto y muestran el `valor_hora` **actual**. **Mitigación:** columnas `valor_hora_aplicado` + `moneda_aplicada` en cada `time_entry`, y los reportes leen esas columnas **sin join** con `projects`. Un test de integración cambia el `valor_hora_default` de un proyecto, verifica que el reporte histórico no cambia, y falla si algún query hace join transitorio con `projects.valor_hora_default`.
- **R-3 — Plan-vs-real con dos fuentes de verdad.** Bookings dice "prometí 4h el jueves", entries dice "cargué 3h el jueves"; ¿es sub-carga o el dev cargó en el ticket equivocado y las 3h del jueves están en otro proyecto? **Mitigación:** el reporte se agrupa por (proyecto × persona × período), no exige match ticket-a-booking. El delta se lee como orientativo, no como acusatorio. La doc del reporte explica la semántica.
- **R-4 — Timer huérfano.** Alguien arranca timer un viernes 18h y lo ve el lunes 9h con 63h corridas. **Mitigación:** advertencia visible desde 12h (AC-2.4). El dato no se pierde; se edita a mano al parar. Alternativa auto-stop está en Q-7 si el caso duele.
- **R-5 — Migration extendida con muchas columnas nuevas y defaults.** Cinco `alter table` en la misma migration, mucho `default not null` para columnas que en producción pueden tardar. **Mitigación:** los defaults se aplican con `alter table … add column … with default`, que en Postgres 15 no reescribe la tabla si el default es constante. En 6 usuarios y unas decenas de filas por tabla, el riesgo es cero, pero la migration sigue la disciplina de "fase agregar → deploy código → fase borrar" cuando aplique (no aplica acá: no se borra nada).
- **R-6 — Cliente `interno` sembrado en la migration.** Si mañana un admin renombra o "borra" el cliente interno, las horas de administración quedan huérfanas. **Mitigación:** un `check` constraint que impide `delete` de cualquier cliente con `tipo = 'interno'` si hay proyectos vinculados (que a su vez, por el patrón general del proyecto, no se borran sino que se desactivan). La UI de admin no ofrece el botón "borrar" para `tipo = 'interno'`.
- **R-7 — Doble timer en dos dispositivos.** Un dev arranca timer en la laptop y después abre la app en el celular. Ver ambos "corriendo" es engañoso. **Mitigación:** hay una sola fila en `active_timers` por `user_id` (PK). Ambos dispositivos leen la misma fila; solo uno "corre" en el modelo, aunque ambos muestren la UI del timer. Al parar desde cualquiera, se persiste una vez.
- **R-8 — Cambio de tarifas retroactivo por accidente.** Un admin edita `valor_hora_default` pensando que cambia solo lo nuevo (lo cual es correcto) pero también quiere que se aplique retroactivamente. **Mitigación:** el UI de admin en el detalle de proyecto muestra explícitamente "aplica a cargas futuras — las existentes conservan su tarifa histórica" con un link a la operación explícita `recompute-rate` (fuera del MVP, ver AC-10.5).

---

## 10. Notas

- **Cascada de tarifas y de moneda**: la cascada de moneda es más simple porque proyecto y client la comparten. La migration setea `projects.moneda = client.moneda` para las filas existentes; los proyectos nuevos toman el default del cliente al crearse. Cambiar la moneda de un proyecto con entries cargados **no** cambia `time_entries.moneda_aplicada` — misma razón que las tarifas.
- **Timer y zona horaria**: `started_at` es `timestamptz` (UTC en la DB). La derivación de `fecha` al parar usa la zona local `America/Argentina/Buenos_Aires`. Un timer que se para 00:15 del sábado (hora local) produce una entry con `fecha = viernes` si el `started_at` fue viernes a la tarde — es decir, la fecha del entry se decide al **parar**, no al arrancar. Esto es intuitivo para el usuario y evita partir la sesión.
- **Endpoint de export CSV**: se implementa como `Response` de `text/csv` que escribe stream desde el server, no como generación en cliente. Los reportes de 6 personas × 250 entries/mes son <2 kB; no hace falta paginación. Se pide el rango en query params y se responde de un tiro.
- **Rol `staff` y `min(1)` de `roles`**: en `012` se fijó que `roles.length >= 1` a nivel DB. Agregar `staff` al enum permite que administración tenga rol propio en vez de forzar `developer` (que contamina reportes de capacidad, R-3 de `014`). Al onboarding de un profile nuevo desde `/admin/users`, el admin elige `staff` si corresponde.
- **`bookings.ticket_id`**: opcional y nullable, sin FK cascade agresiva (`on delete set null` — si se borra el ticket, el booking pierde su asociación pero sobrevive). Nada del flujo de aprobación de bookings depende del ticket; es metadata.
- **`audit_log`**: se agregan tres tipos nuevos: `entity = 'time_entry'`, `entity = 'active_timer'` (start/stop), y `entity = 'project_quota'`. Igual patrón que el resto (trigger en la misma transacción, ADR 0012).
- **RLS de reportes**: los reportes son queries derivadas sobre tablas con RLS. No hay policies especiales para "el reporte"; PostgREST filtra las filas por RLS y el reporte se computa sobre lo visible. La visibilidad de **columnas** (montos) se resuelve en el server component, no en RLS (que es row-level, no column-level).
