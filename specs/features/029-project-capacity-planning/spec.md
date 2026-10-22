# Spec — Pantalla de planificación de capacidad por proyecto

- **ID:** 029-project-capacity-planning
- **Estado:** draft
- **Referencias:** `011-planning-view` (origen del look & feel: grilla 4 semanas, sticky header, popover al clickear celda — `src/components/calendar/planning-view.tsx`). `015-project-membership-and-tickets` (`project_members` como fuente de "devs del proyecto"). `028-projects-list-filters-and-actions` (patrón RPC `security definer` admin + PM primario para operaciones acotadas por rol). `016-time-tracking` (precedente de granularidad de 15 min). ADR 0010 (patrón RPC cuando RLS no alcanza o es desproporcionada).

---

## 1. Objetivo

Agregar una pantalla **nueva, global**, para que el PM primario cargue **capacidad estimada** por desarrollador y día dentro de un proyecto: una grilla con los devs del proyecto en las filas y los días del mes (4 semanas) en las columnas, cada celda clickeable abre un popup con un input "Horas estimadas" y guarda una fila de `capacity_estimates`.

Es una **entidad nueva, más liviana que `bookings`**: no tiene horario puntual (solo hs/día), no requiere aprobación del dev, no participa del anti doble-booking. Convive con bookings — el PM usa esta pantalla para **planificar antes** de empezar a reservar en firme. En un futuro reporte "plan vs real", `capacity_estimates` es el plan y `time_entries` es lo real.

---

## 2. Contexto

Hoy el PM que quiere **estimar** cuánto va a demandar un proyecto a cada dev tiene dos opciones malas:

1. **Reservar bookings "borrador"**: implica horarios puntuales (`starts_at`/`ends_at`), aprobación del dev, anti doble-booking. Para una estimación de capacidad eso es demasiado — la primera semana nadie sabe en qué franja va a estar sentado.
2. **Hoja de cálculo aparte**: sale del sistema. Nadie ve el dato cuando necesita decidir, y hay que mantenerlo sincronizado con las reservas reales a mano.

La pantalla nueva ataca el problema de origen: el PM primero carga "en el día X, el dev Y va a dedicar 4 h al proyecto Z" como declaración de intención. Después, cuando sabe el horario, hace la reserva en `/calendar`. Las dos cosas conviven porque sirven a flujos distintos:

- `bookings` = compromiso con hora concreta, aprobado por el dev, inmovible por otros proyectos salvo prioridad.
- `capacity_estimates` = declaración de intención a nivel día, visible por el equipo, sin bloqueo de agenda.

**Nombre interno de la pantalla**: "Planificación" (global, como `/calendar?view=planning`), con un selector de proyecto arriba. La estética es la de `src/components/calendar/planning-view.tsx` — grilla densa, 28 columnas de día, sticky header, popover al clickear.

---

## 3. User stories

- **US-1 · Elegir proyecto y ver su grilla** — Como PM primario del proyecto X, quiero entrar a la pantalla nueva, seleccionar X del selector de proyecto, y ver una grilla de 4 semanas con **los miembros activos** del proyecto como filas y los días como columnas.
- **US-2 · Cargar una estimación** — Como PM primario, click en una celda (dev Y, día D) → se abre un popup con un input "Horas estimadas" y botón "Guardar". Guardo "4 h". La celda ahora muestra "4 h" con un color de fondo que la diferencia de las vacías.
- **US-3 · Editar una estimación existente** — Click en una celda con valor → el popup abre con "4 h" ya en el input. Cambio a "6 h" + Guardar → la celda actualiza.
- **US-4 · Borrar una estimación** — Dentro del mismo popup, botón "Borrar". La celda vuelve al estado vacío (y la fila de `capacity_estimates` se elimina).
- **US-5 · Ver sin editar (miembro contributor+ u otros)** — Como contributor o lead del proyecto, quiero poder entrar a la misma pantalla y ver la grilla con las estimaciones de todos, sin poder editarlas. Los PMs ajenos y los no-miembros no ven el proyecto en el selector.
- **US-6 · Navegación temporal** — Como PM, quiero flechas "semana anterior / semana siguiente" como en `/calendar?view=planning`, y un botón "Hoy" que ancla la vista con la semana actual como cuarta fila (patrón de `024-planning-today-anchor`).
- **US-7 · Totales por fila y columna** — Como PM, al pie de cada columna de día quiero ver la **suma de horas estimadas de todos los devs del proyecto ese día**, y a la derecha de cada fila de dev quiero ver el **total semanal del dev** en ese proyecto.

---

## 4. Acceptance criteria

### US-1 · elegir proyecto y ver grilla

- **AC-1.1** — Given la ruta `/planning`, when entro, then veo un `PageHeader` con el título "Planificación" y una toolbar con un `<Select>` "Proyecto" (único control por ahora).
- **AC-1.2** — Given soy admin, when despliego el selector, then veo **todos los proyectos activos** del sistema.
- **AC-1.3** — Given soy PM primario de X y miembro de Y, when despliego el selector, then veo X y Y y nada más (misma visibilidad que `/projects`).
- **AC-1.4** — Given selecciono el proyecto X, when el server resuelve, then la URL pasa a `/planning?project=<key>` y la grilla aparece. Compartir el link reabre el mismo estado.
- **AC-1.5** — Given la URL trae un `?project=<key>` que no existe o no es visible para el usuario, when la página renderiza, then el selector queda vacío y la grilla muestra un `EmptyState` "Elegí un proyecto para ver su planificación".
- **AC-1.6** — Given un proyecto seleccionado, when la grilla renderiza, then las filas son los **miembros activos** del proyecto (de `project_members where active = true`) **más el PM primario** si no está en `project_members`. Ordenadas por nombre, es-AR.
- **AC-1.7** — Given un dev tenía estimaciones cargadas pero fue dado de baja del proyecto (`project_members.active = false`), when la grilla renderiza, then aparece como una fila extra marcada "ex-miembro" al pie de la lista de activos, para que las estimaciones viejas sigan visibles. **No editable** aunque sea admin — editar implicaría re-sumar al dev al proyecto, y el camino para eso es el panel de miembros.

### US-2 · cargar estimación

- **AC-2.1** — Given soy admin o PM primario del proyecto, when hago click en una celda vacía, then se abre un popover con un `<Input type="number" step="0.25" min="0.25" max="24">` enfocado y un botón "Guardar".
- **AC-2.2** — Given tipeo "4" y clickeo Guardar, when el POST `/api/capacity-estimates` responde 200, then el popover cierra y la celda muestra "4 h" con un fondo `bg-primary/10 text-primary` (mismo criterio que la pill del día de `/my-time`).
- **AC-2.3** — Given tipeo un valor inválido (0, negativo, > 24, texto), when apreto Guardar, then el input muestra un mensaje de error inline y el POST no sale.
- **AC-2.4** — Given el POST falla (403, 500), when el error llega, then el popover muestra el mensaje del server inline, no cierra, no cambia la celda.
- **AC-2.5** — El popover se cierra con Esc o click afuera. Esc cancela sin guardar.

### US-3 · editar

- **AC-3.1** — Given click en una celda con valor existente, when el popover abre, then el input viene con el valor actual pre-cargado y seleccionado (para que un tipeo lo pise).
- **AC-3.2** — Given cambio el valor y guardo, when el PATCH `/api/capacity-estimates/[id]` responde 200, then la celda actualiza al nuevo valor.
- **AC-3.3** — El flujo de carga + edición son el mismo popover; solo cambia el método HTTP (POST para nueva, PATCH para existente).

### US-4 · borrar

- **AC-4.1** — Given el popover está abierto sobre una celda con valor, when el usuario clickea "Borrar", then el DELETE `/api/capacity-estimates/[id]` dispara y en 200 la celda vuelve al estado vacío.
- **AC-4.2** — Given la celda está vacía, when el popover abre, then el botón "Borrar" **no aparece** (no hay fila que borrar).
- **AC-4.3** — Entrar `0` o vaciar el input **no borra** — el min del input es 0.25 h; para quitar la estimación hay que usar el botón "Borrar" explícito.

### US-5 · ver sin editar

- **AC-5.1** — Given soy contributor o lead del proyecto (`project_members.role_in_project`), when entro a `/planning?project=<key>`, then veo la grilla igual que un admin **pero sin edición**: click en celda no abre popover, los totales se muestran.
- **AC-5.2** — Given soy contributor y hago click en una celda vacía, when el handler se evalúa, then el click **no hace nada** (afordance consistente con el estado "sin permiso").
- **AC-5.3** — Given no soy miembro ni admin ni PM del proyecto, when despliego el selector, then el proyecto no aparece (mismo criterio que `/projects`).

### US-6 · navegación temporal

- **AC-6.1** — Given la grilla está renderizada, when apreto el botón "←" (semana anterior) en la toolbar, then la grilla se corre una semana atrás y la URL pasa a `/planning?project=<key>&w=<yyyy-MM-dd>`.
- **AC-6.2** — Given la URL no trae `?w=…`, when la página carga, then el ancla por default es "**hoy en la cuarta fila**" (patrón de `024-planning-today-anchor`): 3 semanas pasadas + semana en curso. **Reusa `viewBounds`/`resolveRange` existentes con el case nuevo.**
- **AC-6.3** — Given apreto "Hoy", when el handler corre, then la URL vuelve a `/planning?project=<key>` (sin `?w`) y la grilla ancla hoy en la cuarta fila.

### US-7 · totales

- **AC-7.1** — Given la grilla renderizada, when inspecciono el pie de cada columna de día, then veo la **suma de horas estimadas de todos los devs del proyecto ese día** (ej. "12 h"). Celda vacía si el total es 0.
- **AC-7.2** — Given la grilla renderizada, when inspecciono el margen derecho de cada fila de dev, then veo el **total semanal** del dev en ese proyecto (ej. "20 h"), repetido por cada semana visible — hay 4 columnas de "subtotal" entre semanas, no una sola al final.
- **AC-7.3** — Los totales **no incluyen** estimaciones de otros proyectos. Son totales **de este proyecto**. La vista cross-proyecto queda fuera del MVP (ver §5 "Fuera").

---

## 5. Alcance

### Dentro

- **Nueva ruta `/planning`** (route group `(app)/planning`). Server component `page.tsx` que resuelve el perfil, lista proyectos visibles para poblar el selector, y pasa todo a un client component `<CapacityPlanningView>`.
- **Nueva tabla `capacity_estimates`**: `project_id`, `dev_id`, `date` (DATE, no timestamptz — la unidad es día calendario), `hours` (numeric 4,2), `created_by`, `created_at`, `updated_at`. Unique `(project_id, dev_id, date)` — una estimación por tripla.
- **RPC `security definer` `upsert_capacity_estimate(p_project_id, p_dev_id, p_date, p_hours)`** y **`delete_capacity_estimate(p_id)`**. Patrón ADR 0010: la autorización "admin o PM primario del proyecto" la expresa la RPC, no la RLS. Admin es `has_role('admin')`; PM primario es `pm_id = auth.uid() and has_role('pm')` (hereda `and active` por D-01 como en 028).
- **RLS de `capacity_estimates`**: SELECT abierto por `can_view_project(project_id, auth.uid())` (ya existe en la base). INSERT/UPDATE/DELETE **cerradas** desde cliente — todo pasa por las RPCs.
- **Endpoints**:
  - `POST /api/capacity-estimates` — upsert (crea o actualiza).
  - `DELETE /api/capacity-estimates/[id]` — borra.
  - El PATCH se expresa como el mismo POST (upsert); un cliente que quiere mandar explícito el id en el body puede, pero el handler usa `project_id + dev_id + date` como clave natural de todos modos.
- **Validación Zod** para los dos endpoints.
- **Query helper** `getProjectCapacityEstimates(projectId, dateFrom, dateTo)` que devuelve el map `(dev_id, date) → { id, hours }` para renderizar la grilla.
- **Query helper** `getProjectMembersForPlanning(projectId)` que devuelve: miembros activos + PM primario + ex-miembros que tienen estimaciones en el rango.
- **Componente `<CapacityPlanningView>`** (nuevo, client): grilla + popover + sincronización con URL. **Reutiliza las constantes `CELL_WIDTH`, `LABEL_WIDTH`, `ROW_HEIGHT`** del `planning-view` del calendar extrayéndolas a `src/lib/planning/constants.ts` para que las dos vistas no diverjan. **No** reutiliza el componente — las semánticas son muy distintas (edición vs read-only).
- **`viewBounds` / `resolveRange`** extendidos con un case `"capacity"` análogo a `"planning"` de 024 (hoy en la cuarta fila).
- **Agregar la ruta al nav lateral** (`AppShell`), como un ítem más entre "Calendario" y "Proyectos" (orden aproximado por frecuencia de uso).
- **Totales**: sumas en cliente, con `useMemo`. No bajan al server.
- **Tests**:
  - Unit: validation Zod, query de totales (`sumByDay`, `sumByDevWeek`), parser de search params de la ruta.
  - Integration: RLS de `capacity_estimates` (viewer puede leer, solo admin/PM pueden escribir via RPC; miembro ajeno no lee), RPC `upsert_capacity_estimate` con los 4 escenarios de autorización + no-op (upsert mismo hours → updated_at no cambia opcional), `delete_capacity_estimate` autorización, unique constraint (upsert reemplaza, no duplica).
  - Smoke: endpoints POST + DELETE con 200/400/403/404.

### Fuera (explícito)

- **Vista cross-proyecto**: la grilla muestra solo el proyecto seleccionado. Para ver la carga total del dev X este mes mirando todos sus proyectos, hay que entrar proyecto por proyecto. La vista cross-proyecto sería `/calendar?view=planning` pero sobre `capacity_estimates` en vez de bookings — queda como siguiente feature si aparece la necesidad.
- **Alerta de sobrecarga** (ej. "este dev tiene 20 h estimadas el martes sumando 3 proyectos"). Sin vista cross-proyecto no se puede computar; se lleva junto cuando aparezca.
- **Cargar al dev directamente** (como contributor estimando su propia carga). Modelo abierto fuera del MVP; `has_role('pm')` es el guard elegido con el usuario.
- **Multi-semana en el popup** ("cargar 4 h/día de L a V"). El MVP es celda por celda. Un futuro atajo "repetir en todos los días hábiles de la semana" cabe en el mismo popup sumando un botón, sin cambiar modelo.
- **Importar desde bookings** ("convertir reservas existentes en estimaciones"). Los dos conviven, no se cruzan.
- **Notificaciones** cuando el PM carga una estimación sobre un dev. No es un compromiso, no cambia la agenda del dev — notificar sería ruido.
- **Audit log de cambios de estimaciones**. Son de bajo valor histórico y la tabla no está sujeta a disputa (sin aprobación, sin anti-colisión). Si aparece la necesidad, se suma un trigger como el de `projects_log_priority_change` sin tocar la UI.
- **Reporte "plan vs real"** cruzando `capacity_estimates` con `time_entries`. Prerequisito: esta feature. Se hace aparte, probablemente agregándolo a `/reports/plan-vs-real` que hoy mira bookings.
- **Granularidad distinta a 15 min**. `step=0.25` deja 15 min como mínimo, igual que `time_entries` de 016.
- **Cambios al `/calendar?view=planning` existente**. Ese sigue siendo sobre bookings, y la pantalla nueva es independiente.
- **Filtros por cliente/dev dentro de la grilla**. Un selector de proyecto es suficiente para el MVP.

---

## 6. Dependencias y hallazgos

- **011 — Planning view del calendar**: la referencia visual. `src/components/calendar/planning-view.tsx` tiene las constantes de grilla, la lógica de "4 weeks", el sticky header. Extraer las constantes compartidas a `src/lib/planning/constants.ts` evita que una divergencia visual entre `/calendar?view=planning` y `/planning` (nuevo) pase sin querer.
- **015 — `project_members`**: fuente de "devs del proyecto". El PM primario (`projects.pm_id`) puede no tener fila en `project_members`, por eso la query lo suma aparte.
- **024 — Hoy en la cuarta fila**: `viewBounds` / `resolveRange` acepta un parámetro opcional `today` para el case "planning". Extender para el case "capacity" es un cambio puntual en `src/lib/calendar/range.ts`.
- **028 — RPC + guard de PM primario**: patrón reutilizado tal cual. La RPC `upsert_capacity_estimate` tiene las mismas dos ramas de autorización.
- **016 — `time_entries` granularity**: `hours numeric(4,2)` con step 0.25 min = 15 min. Mismo criterio.
- **Hallazgos del code review** (2026-10-21):
  - **`can_view_project(uuid, uuid)` ya existe** en la base (015) — la RLS de SELECT de `capacity_estimates` la reusa sin agregar nada.
  - **La ruta `/planning` no existe hoy**: ningún route handler ni page la ocupa. Libre.
  - **El nav lateral** se arma en `src/components/app-shell/*` (verificar al implementar — hay que sumar el item con un ícono apropiado, ej. `CalendarRange` o `BarChart3` de lucide).
  - **`projects.pm_id` es `not null`**: no hace falta un fallback null para "proyecto sin PM".
  - **El selector de proyecto puede reusar `<SearchableSelector>` de 027** cuando hay 10+ proyectos. Si son pocos, un `<Select>` plain basta — mismo criterio que `/my-time`.

---

## 7. Preguntas abiertas

- **Q-1 · Nombre interno de la ruta**: ¿`/planning` o `/capacity`? **Recomendación por defecto:** `/planning`. Hoy no colisiona, y el usuario describió "la estética de Planificación". El `/calendar?view=planning` sigue existiendo adentro de calendar — son dos ejes distintos (reservas globales vs planificación de capacidad por proyecto). Si aparece confusión, se cambia después (ruta nueva, sin consumidores externos). **No bloquea.**
- **Q-2 · Nombre de la tabla**: `capacity_estimates`. Alternativas descartadas: `planning_entries` (muy genérico — hoy "planning" ya es sobre bookings), `project_capacity` (confunde — suena a límite por proyecto). **No bloquea.**
- **Q-3 · ¿La estimación tiene un enum "tipo" (ej. desarrollo, QA, documentación)?** No en MVP. Si aparece la necesidad, se agrega `kind` como columna opcional sin romper nada.
- **Q-4 · ¿El popover permite tipos naturales ("4 h", "4.5 h", "4h 30min")?** Solo decimal (`4`, `4.5`). Un parser más tolerante es ergonomía — vale cuando el equipo lo pida.
- **Q-5 · ¿La grilla muestra el domingo?** Hoy `/calendar?view=planning` incluye los 7 días por semana (28 columnas) y marca los no-hábiles con un fondo distinto. Mantener. Si el PM necesita cargar un sábado por una entrega excepcional, lo puede hacer (nunca bloquea — Q-G de 004).
- **Q-6 · ¿El dev ve la pantalla?** Como contributor o lead sí, read-only (US-5). Como developer puro **sin** fila en `project_members` del proyecto, no ve el proyecto en el selector. **Recomendación:** confirmar que esto es lo esperado — el modelo de "ver el calendar" de 005 era abierto; acá se cierra a membresía. **No bloquea** porque el defecto cae del lado seguro (menos visibilidad), pero si el pedido es "todos los devs ven estimaciones de todos los proyectos", es un cambio de policy menor.
- **Q-7 · ¿Cuál es el formato visual de la celda?** Hoy `/calendar?view=planning` usa colores por carga (ver `isOverloaded`). Para capacity planning puro: celda con número centrado (ej. "4") sobre fondo `bg-primary/10` cuando hay valor, `bg-background` cuando está vacía. Las no-laborables mantienen el fondo gris del calendar.

---

## 8. Métricas de éxito

- **Zero reports** del tipo "no puedo planificar sin hacer reservas". Esta feature ataca justo eso.
- **>= 1 PM primario** cargando >= 10 estimaciones en la primera semana post-deploy (medible: `select count(distinct created_by) from capacity_estimates ... having count(*) >= 10`).
- La grilla carga en < 500 ms para un proyecto con 10 devs × 28 días = 280 celdas (presupuesto generoso).

---

## 9. Riesgos conocidos

- **R-1 · La convivencia con `bookings` confunde**: alguien carga 4 h de estimación y 4 h de booking el mismo día — ¿son 8 h o 4 h? La respuesta de producto es "8 h de intención, 4 h de compromiso real; para carga de agenda se mira el booking". **Mitigación**: la pantalla nueva no muestra bookings, y `/calendar` no muestra estimaciones. Son dos ejes separados. En la UI de ambos lugares conviene una línea de copy que mencione al otro — se decide al implementar.
- **R-2 · El PM primario desactivado como profile sigue teniendo pm_id**: cubierto por `has_role('pm')` que incluye `and active` (patrón de 028).
- **R-3 · Un dev se sale del proyecto, sus estimaciones quedan colgadas**: AC-1.7 las muestra como "ex-miembro" y bloquea edición. No se borran — son historia útil para el reporte plan vs real.
- **R-4 · Alguien edita el PM del proyecto, las estimaciones viejas se "regalan" al nuevo PM**: las estimaciones tienen `created_by`, no `pm_id`. El nuevo PM primario hereda la capacidad de editarlas. **Esto es intencional**: la estimación es del proyecto, no del PM. El `created_by` queda para auditoría, no para autorización.
- **R-5 · Carrera entre dos admins editando la misma celda**: el upsert tiene `on conflict (project_id, dev_id, date) do update` + `updated_at`. El que pierde la carrera sobrescribe al otro. **No es un problema real** para capacity planning — es ergonomía, no compromiso.
- **R-6 · Un PM cambia proyecto en el selector y pierde cambios no guardados**: no aplica — el popover guarda al cerrar, no acumula estado.
- **R-7 · Grilla con 30 devs y 28 días en mobile**: scroll horizontal con sticky de la primera columna. Mismo patrón del calendar planning.
- **R-8 · Rendimiento con muchos proyectos y muchas estimaciones**: la query está acotada a un proyecto y un rango de 28 días. Con 10 devs promedio, el payload es ~280 filas máximas. Nada que optimizar en el MVP.

---

## 10. Notas

- **Migration requerida**: aditiva pura. Crea `capacity_estimates`, policies de SELECT, dos RPCs. No altera tablas existentes.
- **Fases desde 019**: no aplican dos fases porque la tabla es nueva — no hay código viejo que rompa cuando aparezca.
- **ADR**: no requiere uno nuevo. Se apoya en ADR 0010 (RPC + guard) y ADR 0011 (roles como conjunto).
- **Feature mediana**: estimada en 3 phases:
  - **Phase 1**: schema + RPCs + endpoints + tests de integración (sin UI).
  - **Phase 2**: query helpers + componente de grilla + popover + totales en cliente.
  - **Phase 3**: nav lateral + sync con URL + tests manuales por rol + cierre.
  - Phase 1 es deployable silenciosa (sin UI). Phase 2 depende de Phase 1 en prod. Phase 3 cierra.
- **El `plan.md` y `tasks.md` se escriben al arrancar la implementación.**
