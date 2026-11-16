# Spec — Time tracker: correcciones post-launch

- **ID:** 030-time-tracker-fixes
- **Estado:** draft
- **Referencias:** `016-time-tracking` (feature original), `021-time-tracker-tasks-and-export` (rename), `027-time-tracker-polish` (polish + start del cronómetro — esta feature continúa el feedback de uso real).

---

## 1. Objetivo

Resolver seis issues reportados por Emiliano (2026-11-02) después del uso diario post-`027`. Dos de ellos son críticos: (a) **pérdida de datos en el cronómetro** (clickear "Iniciar" mete bloques que el usuario no esperaba o rompe con `23514`), (b) **state loss del dialog** al cambiar de pestaña. El resto son mejoras de visualización y productividad: visualizar el timer en la grilla con todo editable, botón play en las cards para repetir una tarea, cards con toda la info, popover que no se rompe con textos largos, y un entry cargado donde también se pueda editar el proyecto.

Todos los issues tocan la misma superficie (`/my-time`, `<TimeEntryDialog>`, timer) — van juntos en un solo PR como continuación directa de `027`.

---

## 2. Contexto

El time tracker (`/my-time`) tiene uso diario del equipo desde que `027` encendió el start del cronómetro. Dos semanas de uso real sacaron a flote lo siguiente:

- **El bug del cronómetro es serio:** cuando el usuario olvida un timer corriendo (ej. empezó el jueves a las 09:15 y no lo paró) y el lunes clickea "Iniciar cronómetro" de nuevo, el RPC `stop_and_start_timer` **primero** llama a `stop_timer`, que calcula minutes = elapsed → inserta un `time_entry` → recién después arranca el nuevo. Si elapsed > 960 min (16h), el check constraint falla y toda la transacción revierte (nada arrancó, pero el user vio el error `23514`). Si elapsed está entre 15 min y 960, el bloque "random" se cargó silenciosamente. El nombre del constraint (`time_entries_minutes_multiple_15`) es engañoso: cubre las tres condiciones del check — `> 0`, `<= 960`, `% 15 = 0`.

- **El state loss es frustrante:** `useEffect([open, initial])` en el dialog dispara cada vez que `initial` cambia identity. El parent (`<WeeklyGridView>`) construye el objeto `initial` en cada render (líneas 127–160). Al tabear/minimizar, el router puede re-rehydratar, el parent re-renderiza, el objeto `initial` tiene nueva identity y el formulario se resetea aunque siga abierto.

- **La "card del timer corriendo"** es la pieza que falta para que el modelo mental sea coherente: hoy el usuario arranca el cronómetro desde `/my-time` pero el feedback vive solo en la pill del header. Debería verlo en la columna del día del `/my-time` como una card más, con contador vivo y campos editables sin tener que parar.

---

## 3. User stories

- **US-1 · Editar el proyecto de un entry cargado.** Como alguien que cargó un bloque de tiempo contra el proyecto equivocado, quiero poder cambiar el proyecto en la edición (y que activity + ticket se reseteen, porque son por-proyecto), sin tener que borrar y volver a cargar.
- **US-2 · Iniciar un cronómetro sin perder la info del anterior.** Como developer que arranca el día y me doy cuenta que dejé un timer corriendo desde hace días, quiero que al clickear "Iniciar cronómetro" el sistema me avise del timer activo con las opciones de **guardarlo** (cargando lo máximo permitido, 16h) o **descartarlo**, antes de arrancar el nuevo. Nunca más un bloque de 7h aparecido sin explicación.
- **US-3 · Ver el cronómetro corriendo en la grilla.** Como developer con el cronómetro andando, quiero ver la card del timer activo en su columna del día en `/my-time`, con contador en vivo y los mismos campos editables (proyecto, tarea, ticket, notas, hora de inicio). Para corregir la nota mientras trabajo sin tener que parar.
- **US-4 · Repetir una tarea con un click.** Como developer que carga un bloque todos los días sobre el mismo proyecto/tarea/ticket, quiero un botón "play" en la card del bloque que abra el dialog de iniciar cronómetro ya pre-rellenado con esos campos, para no tener que elegirlos de nuevo.
- **US-5 · Ver toda la info de un bloque sin abrir el detalle.** Como PM revisando la planilla de un dev o como el dev mismo, quiero que cada card de la grilla muestre siempre: proyecto, tarea, ticket (si aplica) y notas (si aplica). Hoy la card prioriza uno u otro y pierde información a simple vista.
- **US-6 · Popover que no se rompe con textos largos.** Como alguien que elige un ticket con título largo ("IP Advisory - TA 05 - IP Sales, Licencing and Acquisitions"), quiero que el badge trunque y mantenga el ancho del popover, no que se desborde y rompa el layout.
- **US-7 · No perder lo que estaba escribiendo si me interrumpen.** Como alguien que arrancó a cargar un bloque y me distraje con un Slack, al volver a la pestaña quiero encontrar el formulario tal como lo dejé, no vacío.

---

## 4. Acceptance criteria

### US-1 · editar proyecto en edit mode

- **AC-1.1** — Given abro el dialog de un entry existente en modo edit, when veo el selector de proyecto, then está **habilitado** (hoy está `disabled`).
- **AC-1.2** — Given cambio de proyecto, when el nuevo proyecto se setea, then `activity_id` y `ticket_id` se resetean a `null` automáticamente y los selectores siguientes muestran los del proyecto nuevo.
- **AC-1.3** — Given guardo con proyecto nuevo + activity + ticket válidos, when el PATCH responde 200, then el entry queda actualizado y la grilla se refresca.
- **AC-1.4** — Given cambio al proyecto nuevo pero no soy contributor de ese proyecto, when el PATCH se dispara, then el server responde 403 con `reason: 'not_member'` y la UI muestra el error inline.
- **AC-1.5** — Given el nuevo proyecto exige actividad (tiene ≥1 activa) y envío sin activity, when el server valida, then responde 400 `reason: 'activity_required'` y la UI avisa.

### US-2 · warn-before-overwrite del start del timer

- **AC-2.1** — Given no hay timer activo, when clickeo "Iniciar cronómetro" y confirmo con proyecto + tarea, then arranca directo como hoy.
- **AC-2.2** — Given hay un timer activo (de la sesión anterior o de hoy mismo), when clickeo "Iniciar cronómetro", then el dialog muestra un bloque informativo arriba del formulario con el label del timer activo (ej. "ACORX · Development · ACORX-12") y el tiempo transcurrido humanizado (ej. "3 d 7 h").
- **AC-2.3** — Given el bloque informativo del AC-2.2, when veo las acciones, then tengo tres opciones visibles:
  - "**Guardar y arrancar**" → POST a `/timer/stop` (crea un time_entry capeado a 960 min) → POST a `/timer/start` con los nuevos valores.
  - "**Descartar y arrancar**" → POST a `/timer/discard` → POST a `/timer/start`.
  - Botón **"Cancelar"** del dialog cierra sin hacer nada.
- **AC-2.4** — Given cliqueo cualquiera de las dos acciones de AC-2.3, when las dos requests terminan, then el dialog cierra y la pill del header refleja el timer nuevo.
- **AC-2.5** — Red de seguridad en SQL: `stop_timer` cappea `minutes` a `least(960, ...)`. Un timer olvidado de 48h se guarda como un time_entry de 960 min sin disparar el check constraint. Comentario inline en el RPC explica por qué (el flujo normal avisa; el cap es la red para el caso edge que llegue hasta acá).

### US-3 · running timer card en la grilla

- **AC-3.1** — Given hay un timer activo del viewer, when la página `/my-time` renderiza, then aparece una **card del timer corriendo** en la columna del día que corresponde al `started_at` en zona Buenos Aires (misma zona que usa `stop_timer` para `logged_at`).
- **AC-3.2** — La card se diferencia visualmente de las cargadas (border de énfasis, badge "corriendo" o indicador de pulso). Muestra: project · activity (si hay) · ticket (si hay) · description (si hay) · contador vivo `H:MM:SS` que avanza cada segundo.
- **AC-3.3** — Given la card está renderizada, when cliqueo cualquiera de sus campos editables (started_at, project, activity, ticket, description), then se abre un popover de edición que patchea `/api/time-entries/timer` con el campo cambiado. Al confirmar: `router.refresh()` y la pill del header también actualiza.
- **AC-3.4** — Given cambio el project del timer activo, when el PATCH se envía, then activity_id y ticket_id se limpian (como en US-1), el server valida membership del nuevo proyecto, y el 403 muestra error inline en el popover.
- **AC-3.5** — Given cambio el `started_at` del timer a una hora anterior, when el PATCH se envía y responde 200, then el contador recalcula desde esa hora. Si el nuevo `started_at` cae en otro día local, la card se mueve a la columna del día correspondiente al refresh.
- **AC-3.6** — Given cambio el `started_at` del timer a una hora futura, when el PATCH se envía, then el server rechaza con 400 `reason: 'future_start'` y la UI avisa (`started_at > now()` no tiene sentido para un timer).
- **AC-3.7** — Botón "Parar" en la card (misma lógica que la pill, redirect a `/my-time?edit=<entry_id>`). Botón "Descartar" también disponible.

### US-4 · play en cards cargadas

- **AC-4.1** — Given una card de time entry en la grilla, when hago hover, then aparece un **botón play** entre edit y delete (hoy aparecen edit + delete solo si `canEdit`; play aparece siempre, porque iniciar un timer con esos valores es acción del viewer, no edición del entry).
- **AC-4.2** — Given cliqueo el play, when el dialog se abre, then es el `<TimerStartDialog>` **pre-rellenado** con el `project_id`, `activity_id` y `ticket_id` del entry origen. El viewer confirma o cambia y hace click en Iniciar.
- **AC-4.3** — Given el project del entry origen está desactivado o el viewer no es contributor+ ahí, when el start se dispara, then el server responde 403 y la UI avisa.
- **AC-4.4** — Si al momento de confirmar hay un timer activo, se dispara el flujo de AC-2.

### US-5 · cards con toda la info

- **AC-5.1** — Given una time entry con project + activity + ticket + description, when la card renderiza, then muestra los cuatro campos en el siguiente orden: ticket key (si hay) en la cabecera, nombre de la activity debajo, nombre del project debajo (como línea secundaria), y description (si hay) al pie — truncada a 2 líneas con `line-clamp-2`.
- **AC-5.2** — Given una time entry sin ticket, when la card renderiza, then **sí se muestra el nombre del project** (ya no se queda la card con "Sin ticket · Development" sin aclarar en qué proyecto).
- **AC-5.3** — Given una time entry sin activity, when la card renderiza, then el nombre del project ocupa el espacio principal (misma línea que hoy ocupa activity.name) y no se muestra una fila vacía.
- **AC-5.4** — La densidad visual no explota: la card sigue cabiendo cómoda en la columna del día (grid de 7 columnas en viewport laptop ~1280 px) sin truncar más de lo que trunca hoy.

### US-6 · overflow del SearchableSelector

- **AC-6.1** — Given selecciono un ticket con título largo (>50 caracteres), when la selección se refleja en el trigger del `<SearchableSelector>`, then el label se **trunca con ellipsis** y mantiene el ancho del popover intacto.
- **AC-6.2** — Fix aplica a los tres `<SearchableSelector>` del tracker: proyecto y ticket en `<TimeEntryDialog>`, proyecto y ticket en `<TimerStartDialog>`.

### US-7 · draft persistence

- **AC-7.1** — Given abro `<TimeEntryDialog>` y empiezo a llenar campos (project, activity, ticket, description, horarios), when cambio de pestaña o minimizo el browser, then al volver todos los campos siguen con los valores que escribí.
- **AC-7.2** — Given hago Submit con éxito, when el dialog cierra y vuelvo a abrir un dialog de create, then el formulario arranca vacío (el draft se borra al success).
- **AC-7.3** — Given cliqueo Cancelar, when el dialog cierra, then el draft **sigue vivo** — al volver a abrirlo recuperás lo que estabas escribiendo. (Matchea el caso "me distraje, cierro, vuelvo mañana".)
- **AC-7.4** — El draft tiene **TTL de 24 h** desde el último `write`. Un draft más viejo se descarta al abrir y se arranca limpio.
- **AC-7.5** — El draft está **scoped por `viewer.id`**: una máquina compartida no revela el borrador de un usuario a otro.
- **AC-7.6** — Mismo tratamiento para `<TimerStartDialog>` (misma UX, misma persistencia).
- **AC-7.7** — Para `<TimeEntryDialog>` en modo edit, el draft se guarda por `entry_id`. Dos entries en edición simultánea (muy raro, pero posible) no se pisan.

---

## 5. Alcance

### Dentro

- Migration 27 **aditiva pura**: columna `active_timers.description text` (nullable) + `create or replace` de `stop_timer` para capear minutes a 960 y pasar description al entry resultante. Backward-compatible — timers sin description se comportan igual que antes.
- Nuevo endpoint `PATCH /api/time-entries/timer` para editar in-flight el timer activo. Validaciones análogas a las de start: contributor+ del proyecto si cambia project, ticket/activity por-proyecto, `started_at` no futuro.
- Modificar `PATCH /api/time-entries/[id]` para aceptar `project_id`: si cambia, re-chequear contributor+ del proyecto nuevo y validar ticket/activity contra el proyecto final.
- Modificar `POST /api/time-entries/timer/start`: en vez de llamar directo a `stop_and_start_timer`, chequear primero si hay `active_timer` → si hay, responder 409 con el timer. El cliente decide la acción.
- Nuevo helper client-side `draft-storage.ts` para persistir borradores a localStorage con TTL + scope por usuario.
- Nuevo componente `<RunningTimerCard>` para la grilla.
- Actualizar `<TimeEntryDialog>`, `<TimerStartDialog>`, `<TimeEntryCard>`, `<WeeklyGridView>`, `<SearchableSelector>`.
- La página `/my-time` suma `getMyActiveTimer()` al Promise.all.
- Tests unit sobre: draft storage (TTL, scope, round-trip); humanize elapsed; detección del día local del started_at.

### Fuera (explícito)

- **Timers simultáneos** (más de uno por user). El PK sigue siendo `user_id` solo.
- **Pausa de un timer corriendo.** Hay stop/discard, no hay pause.
- **Historial de timers rechazados / descartados.** El discard borra la fila; `audit_log` ya cubre la trazabilidad.
- **Botón "Iniciar cronómetro" en el header global.** Vive solo en `/my-time` como hoy.
- **Rediseño del `<TimerPill>`.** Queda igual — es el acceso global desde cualquier ruta.
- **Rediseño de la grilla semanal.** Solo se agrega la running card al día del `started_at`; el resto queda idéntico.
- **Botón play desde el detalle de un ticket** (hay otras cards en `/tickets/[key]` que también se beneficiarían). Follow-up si aparece la necesidad.
- **Agregar notas al active_timer vía UI de la pill del header.** La edición de description vive solo en la running card de `/my-time`.
- **Drop del RPC `stop_and_start_timer`** (queda vivo en la base aunque no tenga consumidores — su drop es trabajo de fase 2 si no reaparece).

---

## 6. Dependencias y hallazgos

- **016-time-tracking** — tabla `active_timers`, RPC `stop_timer` / `stop_and_start_timer`, `/api/time-entries/timer/{start,stop,discard}`, `<TimerPill>`, `<TimeEntryDialog>`, `<WeeklyGridView>`, `<TimeEntryCard>`.
- **027-time-tracker-polish** — `<SearchableSelector>` + `<TimerStartDialog>` + endpoint `/timer/start` sin cambios de API en 027.
- **Hallazgos del code review** (2026-11-02):
  - `supabase/migrations/00000000000017_time_tracking.sql:375-378` — `stop_timer` calcula `v_minutes := greatest(15, (extract(epoch from (now() - started_at)) / 60 / 15)::int * 15)`. No tiene cap superior. Para `now() - started_at > 240 h` genera `> 960` y falla el check `minutes_multiple_15`. **Root cause confirmado.**
  - `src/app/api/time-entries/timer/start/route.ts:106` — llama a `stop_and_start_timer`, que arranca con `stop_timer`. Nunca mira si vale la pena stopear o preguntar.
  - `src/components/time-entries/time-entry-dialog.tsx:103, 112-120` — state local con `useEffect([open, initial])`. El `initial` se construye en el parent cada render (`weekly-grid-view.tsx:127-160`).
  - `src/components/time-entries/time-entry-dialog.tsx:296` — `disabled={mode === "edit" || projects.length === 0}` en el project selector. Deliberado en `027`.
  - `src/components/time-entries/time-entry-card.tsx:103-109` — conditional entre `entry.activity?.name` y `entry.project.name` (fallback). El project no se muestra cuando hay activity, y el ticket cuando no hay activity.
  - `src/components/time-entries/searchable-selector.tsx:97` — `<span className="truncate text-left">`. El span es flex-child dentro de un `<button>` flex. Sin `min-w-0` en el span, `truncate` no actúa (default `min-width: auto` del flex item).
  - `src/app/(app)/my-time/page.tsx:52-71` — el `Promise.all` no incluye `getMyActiveTimer()`. El timer vive solo en la pill del header, no en `/my-time`.
  - `active_timers` (migration 17, líneas 94-100) — PK es `user_id`. No tiene columna `description`. Agregarla es aditivo puro.

---

## 7. Preguntas abiertas

Ninguna que bloquee implementación. Decisiones tomadas durante la planificación:

- **Timer olvidado:** avisar antes de pisarlo + capear minutes a 960 como red de seguridad (ambas).
- **Running card editable:** todo editable en vivo via popover inline.
- **Play en card:** abre `<TimerStartDialog>` pre-rellenado (un click extra pero visible qué va a pasar).
- **Project edit:** auto-limpia activity + ticket al cambiar; valida membership del nuevo proyecto.
- **Draft TTL:** 24 h; scope por viewer.id; clear on save; preserve on cancel.

---

## 8. Métricas de éxito

- **Cero reports** del equipo sobre bloques "random" o errores `23514` durante al menos 2 semanas post-deploy.
- **≥ 50% de los usuarios activos del tracker** interactúan con la running card en la grilla (edit started_at, project o ticket mientras corre) durante la primera semana. Medible por el audit_log de `active_timers`.
- **Al menos 1 timer iniciado** desde el botón play de una card por semana (patrón "repetir tarea de ayer").
- Cero regresiones en cold-start del dialog (abrir / cerrar / editar / guardar siguen funcionando como hoy).

---

## 9. Riesgos conocidos

- **R-1 · Patch en vivo del active_timer** puede carrera con el stop (user clickea stop en la pill mientras edita el popover de la card). La RLS filtra por user_id, el `.update()` es idempotente, y si el stop ganó, el PATCH simplemente actualiza 0 filas y devuelve 204. **Mitigación:** el handler verifica `rowCount > 0` y responde 404 `reason: 'no_timer'` si no quedó nada que actualizar; la UI absorbe silenciosamente (misma lógica del `timer-pill.tsx` para `no_timer`).
- **R-2 · Draft storage puede desincronizarse** si dos tabs editan el mismo entry simultáneamente (ambas escriben a la misma key, última gana). **Mitigación:** aceptable — el caso es rarísimo y el peor efecto es perder cambios de uno. No vale la complejidad de usar `BroadcastChannel` para sincronizar.
- **R-3 · El cap a 960 min silencia el caso edge** cuando el user olvidó el timer y espera que el flujo de aviso lo capture. Si por algún camino inesperado llega directo al stop (ej. clickea stop en la pill), el entry queda cargado como 16h sin que el user lo haya aprobado explícitamente. **Mitigación:** aceptable — es más seguro perder la "verdad" del elapsed (que ya era inútil, nadie estuvo trabajando 48h seguidas) que romper la UX con un 500. El pill ya avisa visualmente desde las 12h (`isWarning` en `timer-pill.tsx:81`) así que el usuario tuvo chance de verlo.
- **R-4 · Cambiar project de un entry viejo** puede alterar reportes agregados (consumo, plan-vs-real) de proyectos. **Mitigación:** aceptable — es exactamente el caso de uso ("lo cargué contra el proyecto equivocado"). El `audit_log` captura el cambio.
- **R-5 · El flujo "Guardar y arrancar" dentro del start dialog** hace dos requests secuenciales. Si la segunda falla (ej. 500 del start), el timer viejo ya se guardó. **Mitigación:** aceptable — el entry queda cargado (dato preservado), el user ve el error y puede reintentar el start sin perder nada. Peor que atómico pero mejor que perder el dato por reintentos infinitos.

---

## 10. Notas

- **Requiere migration 25.** Aditiva pura (una columna nullable + un `create or replace` sobre `stop_timer`). Dos-fases ok: el código viejo convive sin ver `description` ni el cap, y nada rompe. Rollback = re-deploy del código viejo (la columna sobra pero no estorba).
- **No requiere ADR.** Las decisiones son locales: una columna, un cap, patrones ya conocidos para RPC y drafts.
- **Esta feature cierra feedback de uso real de `027`.** No reemplaza nada: es iteración.
