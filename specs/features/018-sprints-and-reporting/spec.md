# Spec — Sprints por proyecto y reporte de fin de sprint

- **ID:** 018-sprints-and-reporting
- **Estado:** draft
- **Referencias:** `015-project-membership-and-tickets` (tickets, membresías), `017-workspaces-and-boards` (workspace por proyecto, tabs). Fuera de la spec funcional original.

---

## 1. Objetivo

Permitir que cada proyecto organice su trabajo en **sprints** — ventanas de tiempo con un set de tickets comprometidos y una estimación en horas — y que al cerrar cada sprint el PM tenga un **reporte inmutable** de qué se planificó, qué se completó y qué quedó pendiente. Los tickets no completados se pasan solos al siguiente sprint (el PM confirma la creación del siguiente antes de poder cerrar el actual).

Sin reporting de horas reales cargadas — esa dimensión llega con `016-time-tracking`. El reporte de este release es sobre **estimaciones y conteos**.

---

## 2. Contexto

`015` dejó tickets sin agrupación temporal — todo el trabajo vive en un backlog plano, y el tablero de `017` muestra "todo lo abierto" sin distinguir "en qué estamos ahora" de "lo que viene después". Con más de 20 tickets abiertos por proyecto, la pregunta operativa se vuelve "¿en qué estoy comprometido esta semana?", que la vista actual no responde.

Sprints resuelve eso con el modelo estándar: ventana de tiempo + set comprometido + reporte al cierre. La cadencia queda en manos del PM (por sprint, no global) porque proyectos distintos tienen ritmos distintos — un proyecto en descubrimiento con sprints de 1 semana y un proyecto en delivery con sprints de 3 semanas conviven.

---

## 3. User stories

- **US-1 · Crear sprint** — Como PM del proyecto, quiero definir un sprint con fechas, nombre opcional y objetivo opcional, para poder planificar el trabajo de las próximas N semanas.
- **US-2 · Activar sprint** — Como PM, quiero marcar un sprint como "activo" cuando arranca (típicamente el lunes de la ventana), para que el equipo sepa qué está en juego ahora.
- **US-3 · Planificar el sprint** — Como PM o lead, quiero mover tickets desde el backlog al sprint activo (o a un sprint planificado a futuro), y sacarlos si cambia el alcance. La estimación en horas del ticket es opcional y se puede setear inline.
- **US-4 · Ver el sprint activo** — Como cualquier miembro del proyecto, quiero un tab dedicado al sprint activo con su kanban filtrado a los tickets comprometidos, para trabajar sin distraerme con el backlog.
- **US-5 · Cerrar sprint** — Como PM, quiero cerrar el sprint activo cuando llegó a su fin. Los tickets no completados se pasan solos al siguiente sprint planificado. Si no hay siguiente sprint, la app me obliga a crearlo antes de dejarme cerrar. Al cerrar, se genera un reporte inmutable.
- **US-6 · Ver reportes de sprints pasados** — Como PM (o cualquier miembro), quiero un tab "Old Sprints" con la lista de sprints cerrados y sus reportes, para hacer retrospectiva.

---

## 4. Acceptance criteria

### US-1 · crear sprint

- **AC-1.1** — Given soy admin o PM del proyecto, when abro el tab "Sprint" y clickeo "Crear sprint", then se abre un dialog con campos: **fecha de inicio (req)**, **fecha de fin (req)**, **nombre (opcional)**, **objetivo (opcional)**. `ends_at >= starts_at` valida en el schema. El sprint se crea con `status = 'planned'`.
- **AC-1.2** — El **`numero`** del sprint lo asigna un trigger, auto-incrementado por proyecto (mismo patrón que `tickets.numero`). En UI se muestra como "Sprint N" cuando `name` es null, o como el nombre custom si existe.
- **AC-1.3** — Puede haber múltiples sprints `planned` simultáneos por proyecto (para planear varios adelante). Puede haber cero.

### US-2 · activar sprint

- **AC-2.1** — Given soy admin o PM del proyecto y hay un sprint `planned` sin otro activo en el proyecto, when clickeo "Activar" en ese sprint, then pasa a `status = 'active'`.
- **AC-2.2** — **Solo un sprint puede estar `active` por proyecto a la vez** — enforcement dura con `unique partial index where status = 'active'`. Si intento activar un segundo, la API rechaza con 409 y motivo.
- **AC-2.3** — Un sprint `planned` puede activarse **antes o después** de su `starts_at`. La fecha es informativa, no gate. El PM manda el ritmo.

### US-3 · planificar

- **AC-3.1** — Given soy admin, PM del proyecto o `lead`, when veo un ticket en el backlog o en el tablero, then puedo asignarlo a un sprint (`active` o `planned`) mediante un `<Select>` con las opciones "Sin sprint" + los sprints no cerrados del proyecto.
- **AC-3.2** — `contributor` **no puede** cambiar `sprint_id` de un ticket — es organización de trabajo, no ejecución. Se enforze en el trigger `enforce_ticket_contributor_scope` (extendiéndolo con `sprint_id` en la whitelist restringida a lead+).
- **AC-3.3** — Given un ticket, when le seteo `estimated_hours` (numeric, ≥ 0, opcional), then se guarda. Se puede editar desde el detalle del ticket o inline desde el sprint/backlog.
- **AC-3.4** — Un ticket con `sprint_id` de un sprint **completado** no puede reasignarse — está congelado en la historia. La API rechaza; en UI el `<Select>` no incluye completados como opción.

### US-4 · ver el sprint activo

- **AC-4.1** — Given el workspace del proyecto, when abro el tab **"Sprint"** (default del workspace), then veo:
  - Si hay sprint activo: header con nombre / número / fechas / objetivo (si hay) / progreso de horas (estimadas completadas / total estimadas), y **kanban filtrado a los tickets del sprint** (mismo componente que `/board`, con `sprint_id = active.id`).
  - Si no hay sprint activo pero hay planificados: empty state con "Activá un sprint planificado" y lista de los `planned` para activar.
  - Si no hay ninguno: empty state con "Crear sprint".
- **AC-4.2** — Debajo del kanban del sprint activo se muestra una sección **"Próximos sprints"** con los `planned` del proyecto — cada uno con fechas, cantidad de tickets asignados, y un botón "Activar" (habilitado solo cuando no hay otro activo).
- **AC-4.3** — Si el sprint activo tiene tickets **sin `estimated_hours`**, la UI muestra una advertencia visible (`circle-alert` en `--attention`, `DESIGN.md` §8) con la cantidad. **No bloquea** — la estimación es opcional (Q-1 respondida).

### US-5 · cerrar sprint

- **AC-5.1** — Given soy **PM primario del proyecto** (no admin, no lead), when clickeo "Cerrar sprint" en el sprint activo, then:
  - Si **hay tickets no completados** (`status ∉ {done, cancelled}`) **y hay al menos un sprint `planned`** en el proyecto: el diálogo confirma, y al aceptar mueve esos tickets al siguiente sprint `planned` (ordenado por `starts_at asc`, o si empatan por `numero asc`) y cierra el actual.
  - Si **hay tickets no completados y NO hay sprint `planned`**: el diálogo **bloquea el cierre** con el mensaje "Creá el próximo sprint antes de cerrar este" y un botón directo "Crear sprint" que abre el dialog de creación. Al terminar, vuelve al flujo de cierre.
  - Si **no hay tickets no completados**: el diálogo confirma y cierra directo.
- **AC-5.2** — Al cerrar, el sprint pasa a `status = 'completed'`, se setea `closed_at = now()` y se guarda un snapshot inmutable en `report jsonb` con:
  - Tickets al momento del cierre: total, completados (`done` + `cancelled`), pendientes rolleados al siguiente sprint.
  - Horas estimadas totales, horas estimadas completadas, % de completitud.
  - Breakdown por asignado: cuántos tickets y cuántas horas estimadas cerró cada uno.
  - Fechas planeadas y fecha real de cierre.
- **AC-5.3** — El reporte **NO se recalcula** después. Es una foto — el `report` jsonb queda fijo aunque después alguien edite un ticket viejo del sprint. Un cambio post-cierre en un ticket no cambia el reporte.
- **AC-5.4** — Admin puede **crear, editar y activar** sprints (mismo permiso que el PM), pero **no cerrarlos** — la firma de cierre es del PM primario. Motivo: el reporte de sprint es un compromiso de accountability del owner del proyecto, análogo al PM aprobando un cambio de status.

### US-6 · old sprints

- **AC-6.1** — El tab **"Old Sprints"** muestra solo sprints en `status = 'completed'`, ordenados por `closed_at desc`. Cada fila lista número/nombre, fechas, cantidad de tickets planeados vs completados, y horas estimadas planeadas vs completadas.
- **AC-6.2** — Click en una fila abre `/projects/[key]/sprints/[N]` con el reporte completo del snapshot y la lista de tickets que estuvieron en ese sprint (con su status final).
- **AC-6.3** — El tab es visible para cualquier miembro del proyecto — la historia es de todos, no solo del PM.

---

## 5. Alcance

**Dentro:**
- Tabla `sprints` con enum de status, unique partial de active-por-proyecto, y trigger de numeración correlativa.
- Columnas nuevas en `tickets`: `sprint_id` y `estimated_hours`.
- Extensión del trigger `enforce_ticket_contributor_scope` para bloquear a contributors de cambiar `sprint_id`.
- API: `POST /api/sprints` (crear), `PATCH /api/sprints/:id` (edit / activate), `POST /api/sprints/:id/close` (cierre con rollover), más los cambios a `PATCH /api/tickets/:id` para aceptar `sprint_id` y `estimated_hours`.
- Tabs nuevos en el workspace: **Sprint** (reemplaza Tablero como default, mostrando activo + próximos) y **Old Sprints**. El tab "Tablero" existente se mantiene renombrado como **"Tablero completo"** (vista panorámica de todos los tickets sin filtro de sprint).
- Vista de reporte de sprint cerrado: `/projects/[key]/sprints/[N]`.
- Advertencia visible cuando el sprint activo tiene tickets sin estimar.

**Fuera:**
- Auto-cierre de sprints por fecha (descartado — todo pasa por acción del PM).
- Horas cargadas reales vs estimadas (llega con `016-time-tracking`; el reporte lo suma sin cambios de schema, se lee de `time_entries` en tiempo de render).
- Retrospectiva colaborativa (comentarios de sprint, action items).
- Story points o cualquier estimación que no sea horas.
- Velocity chart cross-sprints.
- Sprints cross-project (fuera por decisión del cuestionario).
- Delete de sprints (solo cerrar; los planificados que ya no se van a usar se dejan y no se activan, o se editan a "de descarte").
- Rollover de tickets a un sprint específico elegido por el PM (siempre va al próximo `planned` por fecha).

---

## 6. Preguntas abiertas

- **Q-1** — ¿`estimated_hours` es obligatoria u opcional? **Respondida: opcional**, con warning visible en el header del sprint cuando hay tickets sin estimar. Fricción cero al alta, disciplina por hábito.
- **Q-2** — ¿Duración default o configurable por sprint? **Respondida: configurable por sprint** — cada sprint elige sus fechas al crearse, sin default global.
- **Q-3** — ¿El cierre es manual o auto-por-fecha? **Respondida: manual y solo del PM.** El cron desaparece del scope.
- **Q-4** — ¿Rollover automático o preguntar? **Respondida: automático** al siguiente `planned`. Si no hay `planned`, el cierre queda bloqueado hasta crearlo.
- **Q-5** — ¿Fusionar tabs "Sprint" y "Sprints"? **Respondida: no fusionar.** El tab "Sprint" muestra el activo + planificados; "Old Sprints" solo los cerrados.
- **Q-6** — ¿Admin puede cerrar sprints o solo el PM? **Respondida: solo PM primario.** Admin puede todo lo demás; la firma de cierre es del PM.
- **Q-7** — ¿Contributor puede cambiar `sprint_id` de un ticket? **Respondida: no.** Solo admin, PM del proyecto o lead. La organización del sprint es planning, no ejecución.

Sin abiertas restantes.

---

## 7. Riesgos

- **R-1 · Solo-un-active-por-proyecto** es una regla dura que se enforza en la base con un unique partial. Un intento simultáneo de activar dos falla con 23505; la API lo traduce a 409 con motivo. **Mitigación:** el UI deshabilita el botón "Activar" cuando ya hay otro activo — el 409 es el defensa de segunda línea.
- **R-2 · El reporte snapshot puede quedar out-of-sync con la realidad** si post-cierre alguien edita un ticket que estuvo en el sprint. Es un feature: el snapshot es la verdad al cierre, no la verdad del "ahora". El reporte tiene una nota "Congelado el DD/MM/YYYY". **Mitigación:** la nota es explícita en el UI del reporte.
- **R-3 · Rollover con sprint planificado que arranca mucho después.** Si el PM cierra el sprint hoy pero el siguiente `planned` arranca dentro de tres semanas, los tickets pendientes quedan asignados a un sprint que no está activo — se ven en el tab "Sprint" bajo "Próximos", pero no aparecen en el kanban del activo (no hay). **Aceptable:** es el estado real del proyecto. Si el PM lo quiere trabajar antes, activa el próximo sprint.
- **R-4 · Contributor descubre que no puede mover un ticket a un sprint.** La UI esconde el control cuando el rol no da; el trigger enforce por si vuelve por la API. **Mitigación:** copy claro en la UI ("Solo un lead o el PM pueden reasignar sprints") si el usuario intenta interactuar.
- **R-5 · Sprint numbering colisiones al backfill.** No hay backfill — sprints es tabla nueva. `next_sprint_number` empieza en 1 para cada proyecto existente. Cero riesgo.
- **R-6 · Tab "Tablero completo" vs "Sprint" — confusión de qué muestra qué.** Dos kanban en el workspace es denso. **Mitigación:** el default del workspace es "Sprint" (lo que el equipo ve el 95% del tiempo); "Tablero completo" queda para vista panorámica ocasional y su label lo aclara.

---

## 8. Dependencias

- **015** — tickets, membresías, RLS por proyecto.
- **017** — workspace por proyecto con tabs. Se agregan dos tabs; el "Tablero" existente se renombra.
- **NO depende de 016** (time-tracking). Convive sin problemas — cuando aterrice, el reporte suma la comparación estimado vs real leyendo de `time_entries`, sin cambios de schema.

---

## 9. Compatibilidad con features futuras

- **016-time-tracking** — cuando aterrice, el reporte de sprint suma una sección "Horas reales cargadas" y un ratio estimado/real. Sin cambios al schema de sprints ni al snapshot — se lee de `time_entries` en tiempo de render (y opcionalmente se congela en `report.actual_hours` la próxima vez que se abra un sprint post-016).
- **019+ retrospectivas** — la vista de reporte queda con espacio para sumar comentarios/action items debajo del snapshot. Sin cambios estructurales necesarios.
