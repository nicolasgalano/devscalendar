# Spec — Pantalla de proyectos: orden, buscador, filtro activos y acciones

- **ID:** 028-projects-list-filters-and-actions
- **Estado:** draft
- **Referencias:** `017-workspaces-and-boards` (origen de `/projects` como raíz del sistema de tareas, componente `<ProjectList>`, helper `getVisibleProjects`). `002-entities-admin` (ABM original de proyectos en `/admin/projects`, único lugar hoy con toggle activo/inactivo). `012-multiple-roles-and-active-enforcement` + `013-registered-debt-cleanup` (contexto de `has_role()` con `and active` y modelo de roles como conjunto). ADR 0010 (patrón `security definer` para operaciones que la RLS no puede expresar).

---

## 1. Objetivo

Mejorar la pantalla de listado de proyectos (`/projects`) con cuatro cambios que la vuelven usable como punto de partida real del día a día: **orden por columna**, **buscador por nombre+cliente**, **filtro de proyectos activos** y **columna de acciones** con "Ver" (navegar al workspace) y "Activar/Desactivar".

Además, **se elimina la columna "Tickets abiertos"** — métrica que entra en el workspace del proyecto, no en la lista.

El cambio implica abrir la operación de **togglear `active`** al PM primario del proyecto (hoy solo admin desde `/admin/projects`), lo que requiere una RPC `security definer` nueva (patrón ADR 0010) porque la policy actual de `projects` es `admin write`.

---

## 2. Contexto

Hoy `/projects` es una tabla densa que lista los proyectos visibles para el usuario (admin ve todos; PM/miembros ven los suyos, por filtro aplicativo en `getVisibleProjects` — más restrictivo que la RLS de `projects`, ver `017`). Es la raíz del sistema de tickets: desde acá se entra al workspace de un proyecto puntual (`/projects/[key]/*`).

Problemas que motivan la feature:

- **No se puede ordenar.** La tabla sale ordenada por nombre ascendente y no hay forma de cambiar criterio. En un equipo con 15+ proyectos activos, buscar "el proyecto de X cliente" es scroll a mano.
- **No hay buscador.** Para encontrar un proyecto por nombre o cliente, hay que leer la tabla entera.
- **Los proyectos inactivos se mezclan con los activos.** Hoy bajan a `text-muted-foreground` (`DESIGN.md` §8) pero siguen ocupando filas; en un equipo con historial, los inactivos crecen y empujan los activos abajo.
- **La columna "Tickets abiertos" no suma donde está.** El número crudo sin contexto (sin breakdown por estado, sin sprint actual, sin asignado) no decide nada. El verdadero contador vive en el workspace del proyecto (tablero kanban + backlog). Mantenerlo en la lista obliga a una **segunda query agregada** (`select project_id, id.count() from tickets ... in (...)`) que escala con `visible.length` proyectos y no aporta.
- **Falta una vía rápida para activar/desactivar.** Hoy, para dar de baja un proyecto, el admin tiene que ir a `/admin/projects` y buscarlo ahí. Si el proyecto está terminado y el PM lo sabe antes que el admin, no puede cerrarlo él mismo.

La feature no toca el workspace de proyectos ni el detalle (`/projects/[key]/*`). Solo la **pantalla de listado**.

---

## 3. User stories

- **US-1 · Ordenar por columna** — Como PM que entra a `/projects` para elegir dónde arrancar el día, quiero poder clickear el header de "Proyecto" o de "Cliente" para ordenar ascendente/descendente, sin tener que recordar en qué orden salen por default.
- **US-2 · Buscar por nombre o cliente** — Como alguien con 10+ proyectos a la mano, quiero tipear parte del nombre del proyecto o del cliente en un buscador y ver solo las filas que matchean, sin tener que leer todo.
- **US-3 · Esconder inactivos por default** — Como usuario del día a día, quiero que la primera vista me muestre solo los proyectos **activos** (que es con lo que trabajo) y poder apagar el filtro cuando necesite ver los históricos.
- **US-4 · Ver el workspace desde la lista** — Como usuario, quiero una acción explícita "Ver" por fila que me lleve al workspace del proyecto. (Reemplaza al patrón actual de "fila entera es un link".)
- **US-5 · Activar o desactivar un proyecto desde la lista (admin + PM primario)** — Como admin **o PM primario del proyecto**, quiero poder desactivar un proyecto terminado o reactivar uno archivado directamente desde la lista, sin pasar por `/admin/projects`. El resto de usuarios (miembros, PMs ajenos) no ve esa acción.

---

## 4. Acceptance criteria

### US-1 · ordenar por columna

- **AC-1.1** — Given estoy en `/projects`, when inspecciono los headers de la tabla, then los headers de **Clave**, **Proyecto**, **Cliente**, **PM** y **Estado** son clickeables (con cursor pointer y un ícono de orden al lado del label).
- **AC-1.2** — Given click en el header "Proyecto", when la tabla se re-ordena, then las filas quedan ordenadas por nombre ascendente (A→Z) y el ícono del header muestra la dirección activa.
- **AC-1.3** — Given segundo click en el mismo header, when la tabla se re-ordena, then el orden pasa a descendente (Z→A).
- **AC-1.4** — Given click en el header "Cliente" después de "Proyecto", when la tabla se re-ordena, then el criterio cambia a cliente (y queda solo un header con el indicador activo).
- **AC-1.5** — Given la tabla está ordenada por X, when navego al workspace de un proyecto y vuelvo con el botón "atrás" del browser, then el orden se preserva (vive en search params).
- **AC-1.6** — Given no hay `sort` en la URL, when la tabla carga, then el orden por default es **Proyecto ascendente** (comportamiento actual).
- **AC-1.7** — El orden es **case-insensitive y locale-aware** (`es-AR`), para que "Ñ" caiga donde el PM espera y no al final del ASCII.

### US-2 · buscador

- **AC-2.1** — Given estoy en `/projects`, when inspecciono la toolbar sobre la tabla, then veo un `<Input>` con placeholder "Buscar proyecto o cliente…".
- **AC-2.2** — Given tipeo "and" en el buscador, when el filtro corre, then la tabla muestra solo filas cuyo **nombre del proyecto** o **nombre del cliente** matcheen "and" (case-insensitive, substring, sin acentos sensibles).
- **AC-2.3** — Given el buscador está vacío, when el filtro corre, then la tabla muestra todos los proyectos (modulado por el filtro de activos y el orden).
- **AC-2.4** — Given el filtro deja la tabla vacía, when la lista queda sin resultados, then aparece un `<EmptyState>` con mensaje "No encontramos proyectos con esa búsqueda" y un botón "Limpiar búsqueda".
- **AC-2.5** — Given tipeo en el buscador, when el valor cambia, then el filtro se aplica **al terminar de tipear** (debounce ~200 ms) y la URL se actualiza con `?q=and` (sin acumular entradas en el historial — `router.replace`).
- **AC-2.6** — Given la URL tiene `?q=and` al cargar la página, when la tabla renderiza, then el input viene con "and" pre-escrito y el filtro aplicado.
- **AC-2.7** — El buscador **no toca el server**. El filtro corre en cliente sobre la lista ya traída por `getVisibleProjects` (en equipos con >200 proyectos esto se re-evalúa — ver R-3).

### US-3 · filtro de activos

- **AC-3.1** — Given estoy en `/projects` por primera vez (sin `active` en la URL), when la tabla carga, then el `<Switch>` "Solo activos" está **encendido** y la tabla muestra solo proyectos con `active = true`.
- **AC-3.2** — Given click en el switch para apagarlo, when el filtro cambia, then la tabla muestra **todos** los proyectos (activos + inactivos) con el estilo visual actual (inactivos a `text-muted-foreground`) y la URL pasa a `?active=all`.
- **AC-3.3** — Given el switch está apagado, when click para encenderlo, then la URL vuelve al default (sin `?active`) — regla de la convención: valores iguales al default no viajan en la URL.
- **AC-3.4** — Given el filtro de activos deja la tabla vacía, when la lista queda sin resultados, then el `<EmptyState>` dice "No tenés proyectos activos" con un botón "Ver inactivos" que apaga el switch.
- **AC-3.5** — El switch **respeta el buscador y el orden**: los tres filtros componen y conviven en la URL (`?q=foo&active=all&sort=client&dir=desc`).

### US-4 · acción "Ver"

- **AC-4.1** — Given una fila de la tabla, when inspecciono la columna de acciones, then veo un botón "Ver" (`variant="ghost" size="sm"`, patrón de `/admin/projects`).
- **AC-4.2** — Given click en "Ver", when el handler corre, then navego a `/projects/[projectKey]/board` (mismo destino que hoy el link de la fila).
- **AC-4.3** — Given la **fila entera ya no es clickeable** (cambio respecto a hoy), when hago click fuera de un botón, then no pasa nada. El acceso al workspace es solo por el botón "Ver".
- **AC-4.4** — Given el proyecto está inactivo, when inspecciono la fila, then el botón "Ver" sigue habilitado — el workspace de un proyecto inactivo se visita en modo lectura (comportamiento actual del workspace, no cambia acá).

### US-5 · acción "Activar/Desactivar"

- **AC-5.1** — Given soy **admin**, when inspecciono cualquier fila, then veo el botón "Activar" (si el proyecto está inactivo) o "Desactivar" (si está activo) en la columna de acciones.
- **AC-5.2** — Given soy el **PM primario** del proyecto (es decir, `projects.pm_id = auth.uid()`), when inspecciono mi fila, then veo el botón "Activar/Desactivar".
- **AC-5.3** — Given soy **miembro** del proyecto pero **no PM primario**, when inspecciono la fila, then **no** veo el botón "Activar/Desactivar" (solo "Ver"). El PM primario es una sola persona por proyecto (`projects.pm_id`, Q-A); el resto son miembros.
- **AC-5.4** — Given click en "Desactivar", when el POST responde 200, then la fila se actualiza inmediatamente a `active=false` (bajando a muted-foreground), y según el filtro vigente puede quedar fuera de la vista (si `?active=on`).
- **AC-5.5** — Given click en "Activar", when el POST responde 200, then la fila pasa a `active=true` y aparece arriba (sujeta al orden activo).
- **AC-5.6** — Given click en "Desactivar/Activar", when el server rechaza la operación (403, 404, 500), then el error se muestra inline sobre la tabla con el mensaje del server y el estado del proyecto no cambia visualmente.
- **AC-5.7** — Given soy PM primario de **otro proyecto** pero no de este, when inspecciono la fila de este proyecto, then **no** veo el botón "Activar/Desactivar" (misma regla que AC-5.3).
- **AC-5.8** — El toggle **no pide confirmación**. Es consistente con `/admin/projects` hoy, y el proyecto desactivado se puede reactivar con un click (no hay dato que se pierda — ver §6 "D-08").
- **AC-5.9** — El toggle **se audita** (`audit_log`, acción `project.active_toggled`, con `old` y `new` del `active` + `actor_id`). Mismo tratamiento que el audit de `projects` que ya corre hoy.

### US-6 · remover columna "Tickets abiertos"

- **AC-6.1** — Given inspecciono los headers de la tabla, when leo las columnas, then **no** veo "Tickets abiertos".
- **AC-6.2** — Given el helper `getVisibleProjects()`, when devuelve la lista, then el tipo `ProjectListRow` **no incluye** el campo `openTicketCount` ni corre la segunda query agregada contra `tickets`.
- **AC-6.3** — El cambio es incompatible con cualquier consumidor que esperara `openTicketCount`. Un `grep` del repo confirma que el único consumidor es `<ProjectList>` (que lo pierde en este cambio).

---

## 5. Alcance

### Dentro

- **UI**: refactor de `src/components/projects/project-list.tsx` para convertirlo en client component que lee de `useSearchParams()` (patrón de `src/lib/calendar/url.ts`) y aplica buscador + sort + filtro activos en cliente. La lista base sigue viniendo del server (SSR) para que la primera pintura muestre contenido.
- **Toolbar nueva** sobre la tabla: `<Input>` del buscador a la izquierda, `<Switch>` "Solo activos" a la derecha. Alineados a la densidad `DESIGN.md` §4.
- **Sort indicator**: ícono `ArrowUp/ArrowDown` (lucide-react) junto al label del header activo. Headers inactivos muestran un `ArrowUpDown` tenue a `text-muted-foreground/50`.
- **Columna de acciones** nueva, alineada a la derecha, con dos botones chicos (`variant="ghost" size="sm"`): "Ver" + ("Activar" o "Desactivar") según el estado.
- **Columna "Tickets abiertos" eliminada** del `<ProjectList>` y el campo `openTicketCount` sacado del tipo `ProjectListRow` + de `getVisibleProjects()` (incluyendo la segunda query sobre `tickets`).
- **RPC `security definer`** nueva `set_project_active(p_project_id uuid, p_active boolean)` que valida que el caller sea admin O PM primario del proyecto, hace el update y escribe el `audit_log`. Patrón de ADR 0010. Migration aditiva.
- **Nuevo endpoint `POST /api/projects/[id]/active`** (body `{active: boolean}`) que invoca la RPC. Guard custom (sin reusar `requireAdmin()`): admin O PM primario. 403 si no cumple.
- **Validación Zod** en `src/lib/validation/projects.ts` para el body del nuevo endpoint.
- **Preservación del estado** en search params: `q`, `active`, `sort`, `dir`. Convención de `/calendar`: valores iguales al default no se escriben, parser tolerante.
- **Tests unit**: parser de search params (`parseProjectListUrl`), filtro de nombre/cliente (sin match → mensaje, match parcial, case-insensitive), orden locale-aware (es-AR).

### Fuera (explícito)

- **No se toca `/admin/projects`.** El ABM full de admin sigue intacto (crear, editar nombre/PM/prioridad/integraciones + toggle activo). El cambio nuevo solo agrega el **toggle en `/projects`** para PM primario además del admin.
- **No se toca `/projects/[projectKey]/*`** (el workspace del proyecto). La feature es solo sobre la lista.
- **No se cambia el modelo de permisos de proyectos en general.** Esta feature abre **solo** el toggle de `active` al PM primario, no "editar el proyecto". El resto de columnas (nombre, PM, prioridad) sigue siendo admin-only.
- **No se agrega paginación.** Si el buscador en cliente deja de rendir con >200 proyectos activos, se evalúa después (R-3). Hoy no hay equipo con ese volumen.
- **No se persiste el filtro en el perfil del usuario.** Vive en URL únicamente; abrir una pestaña nueva vuelve al default.
- **No se agrega selector multi-cliente ni facetas** más allá del filtro de activos. El buscador cubre el caso "quiero ver los de X cliente".
- **No se agrega confirmación modal** antes de desactivar. Consistente con `/admin/projects`.
- **No se agrega filtro por rol en el proyecto** (soy PM / soy miembro / soy admin). La lista actual ya filtra por participación (`getVisibleProjects`), eso no cambia.
- **No se cambia el default del orden**. Sigue siendo "Proyecto ascendente".
- **No se migran datos**. Es cambio de UI + un endpoint nuevo + una RPC nueva.

---

## 6. Dependencias y hallazgos

- **017-workspaces-and-boards** — origen de `/projects`, `<ProjectList>`, `getVisibleProjects()`. El patrón "fila entera es link" sale de acá y se **rompe** en esta feature (US-4).
- **002-entities-admin** — `/admin/projects/projects-table.tsx` es la referencia visual para "columna de acciones con botones ghost". Mismos labels: "Editar", "Desactivar"/"Activar". Esta feature reusa el patrón, no la implementación.
- **012 + 013 + ADR 0011** — modelo de roles como conjunto. `has_role(auth.uid(), 'admin')` incluye `and active` por D-01, así que la RPC no necesita chequeos sueltos.
- **ADR 0010** — justificación del patrón `security definer` para operaciones que la RLS no puede expresar. El caso de `set_project_active` es análogo: la policy `projects: admin write` filtra al PM primario en silencio; una policy nueva "pm primario toggle active" + trigger de columnas sería **más superficie RLS** por una sola columna. La RPC acotada es la vía chica.
- **Hallazgos del code review** (2026-10-19):
  - `src/components/projects/project-list.tsx` es server component hoy (no `"use client"`). El refactor lo mueve a client porque necesita `useSearchParams` + `useRouter.replace`. El SSR inicial sigue siendo el page.tsx que trae la data.
  - `src/lib/projects/workspace.ts:77-89` es donde vive la segunda query sobre `tickets` que esta feature **elimina**. El tipo `ProjectListRow.openTicketCount` sale del contrato (grep: único consumidor es `<ProjectList>`).
  - `src/app/api/projects/[id]/route.ts:8` usa `requireAdmin()`. **Este endpoint no se toca** — sigue siendo admin-only para el PATCH general. El nuevo endpoint `/api/projects/[id]/active` es independiente y tiene su propio guard.
  - El audit de proyectos: **no hay trigger de audit_log para `projects.active` hoy**. La RPC lo escribe explícitamente (patrón 027/016). Si en el futuro aparece un trigger genérico sobre `projects`, revisar duplicación.
  - El tipo `has_role()` de la base: `has_role(uuid, text)` incluye el guard `active`. La RPC usa `has_role(auth.uid(), 'admin')` + `exists(select 1 from projects where id = p_project_id and pm_id = auth.uid())`.
  - El `active` del PM: si el PM primario se da de baja (`profiles.active=false`), `has_role` lo rechaza en el `admin` branch (por D-01) pero el branch `pm_id = auth.uid()` **no mira `active` del profile**. **Decisión**: la RPC pide `has_role(auth.uid(), 'pm')` adicional para el branch PM, para heredar el guard `active`. Ver F2.
  - El `cn()` de inactivos a `text-muted-foreground` ya existe en `ProjectRow` (línea 50 actual) y se preserva.

---

## 7. Preguntas abiertas

- **Q-1 · ¿La RPC se llama `set_project_active` o `toggle_project_active`?** La primera es más declarativa (recibe el valor nuevo), la segunda implica "inverte lo que haya". **Recomendación por defecto:** `set_project_active(p_project_id, p_active)` — recibir el estado explícito evita la carrera de "dos admins togglean a la vez y uno pisa al otro con el valor viejo". **No bloquea.**
- **Q-2 · ¿El endpoint es `POST /api/projects/[id]/active` o `PATCH /api/projects/[id]` con `{active}`?** El PATCH existente ya acepta `active` pero es admin-only. **Recomendación por defecto:** endpoint nuevo `POST /api/projects/[id]/active`, para que el guard distinto no obligue a bifurcar la lógica dentro del PATCH existente. Mantiene separada la operación "toggle" (admin+PM) de "editar proyecto completo" (admin). **No bloquea.**
- **Q-3 · ¿El buscador también matchea la clave `PROJ-123`?** Hoy la clave es `PROJ`, no se busca por la clave que viene de los tickets. **Recomendación por defecto:** no — matchear la clave es útil para encontrar un ticket por su número, no un proyecto. Mantener nombre + cliente. **No bloquea.**
- **Q-4 · ¿El orden por "Estado" ordena por `active` boolean o por el label visible ("Activo"/"Inactivo")?** Son equivalentes para dos valores. **Recomendación por defecto:** por `active` boolean (`true` primero cuando desc, false primero cuando asc es contraintuitivo — ver si cuesta más que ordenar por label). **No bloquea.**
- **Q-5 · ¿El filtro de activos preserva al proyecto recién desactivado para que el usuario vea la acción exitosa?** Si `?active=on` y el usuario desactiva el proyecto X, X desaparece de la vista inmediatamente. Puede sentirse como "se perdió". **Recomendación por defecto:** sí, desaparece (es consistente con el filtro aplicado), y el `router.refresh()` dispara después del POST. El usuario que quiere verlo apaga el switch. Alternativa (hacer "flash" de 1s antes de ocultarlo) agrega complejidad por poco. **No bloquea.**

---

## 8. Métricas de éxito

- **Zero reports** del equipo sobre "no encuentro el proyecto X" o "quiero ordenar por cliente" post-deploy.
- **Al menos 1 toggle de PM primario** en la primera semana post-deploy (medible: `select count(*) from audit_log where action = 'project.active_toggled' and actor_id != admin_ids`).
- Zero regresión en la navegación: `/projects/[key]/board` sigue siendo el destino al clickear "Ver" y los links viejos no se rompen.
- Zero regresión de performance: la query de `getVisibleProjects` **mejora** (sin la segunda query agregada sobre `tickets`), no empeora.

---

## 9. Riesgos conocidos

- **R-1 · Que un PM se desactive a sí mismo y después nadie pueda reactivarlo.** El toggle vale para proyectos, no para usuarios. **No aplica.** El PM "se desactiva" como persona desde `/admin/users` y eso ya lo cubre `012`. Esta feature no agrega ningún camino para desactivar al PM.
- **R-2 · Que la RPC `security definer` escale privilegios por error.** Mitigación estándar del patrón ADR 0010: la función tiene un `security barrier` implícito, `search_path = public, pg_temp`, y los dos branches (`admin` y `pm_id = auth.uid()`) son booleanos explícitos. Tests de integración de la RPC verifican: (a) admin puede togglear cualquier proyecto, (b) PM primario puede togglear solo el suyo, (c) PM primario de otro proyecto **no** puede togglear este, (d) miembro contributor+ **no** puede togglear.
- **R-3 · Buscador en cliente con >200 proyectos activos.** Hoy no se da (equipo chico). Si en el futuro aparece, la mitigación es (a) subir el debounce a 300 ms, (b) virtualizar la tabla (patrón `@tanstack/react-virtual` del tablero kanban), (c) mover el filtro al server. **No bloquea el MVP.**
- **R-4 · El `router.replace` en cada tecleo genera entradas de historial excesivas.** El uso de `replace` (no `push`) ya lo evita; además el debounce de 200 ms colapsa teclas rápidas. **Mitigación estructural: usar `router.replace`, no `router.push`.**
- **R-5 · El PM primario que ya no es parte del equipo (profile.active = false) sigue teniendo `pm_id`.** El branch PM de la RPC pide `has_role('pm')` que ya incluye `and active`, así que un PM desactivado no puede togglear. Documentado en §6 "hallazgos" y verificado en el test de integración (c).
- **R-6 · Un proyecto desactivado por PM primario queda sin forma de ser reactivado por admin si el usuario cierra la pestaña.** No es un riesgo real: admin sigue viendo todos los proyectos (admin ve activos+inactivos sin filtro) y el toggle le aparece siempre.
- **R-7 · Perder el patrón "fila clickeable" rompe memoria muscular.** Mitigación: el botón "Ver" es el primer botón de la columna de acciones y usa el mismo label visible ("Ver"), no un ícono críptico. El cambio es intencional (US-4) para dejar el contrato claro: la fila **no** es un target completo, los botones **sí** son los targets.

---

## 10. Notas

- **Migration requerida**: aditiva pura. Crea la RPC `set_project_active`. **Sin cambios de schema**, sin drops. Dos fases no son necesarias — la RPC convive con el código viejo sin que nada rompa.
- **ADR**: no requiere uno nuevo. La decisión se apoya en ADR 0010 (patrón RPC `security definer` para operaciones fuera del alcance de RLS) y ADR 0011 (roles como conjunto).
- **Feature chica**. Estimada en 2 phases:
  - **Phase 1**: migration (RPC + validación) + endpoint + guard.
  - **Phase 2**: refactor de `<ProjectList>` a client + toolbar + columna de acciones + eliminar `openTicketCount`.
  - Deployables independientes: Phase 1 puede ir sin UI (nadie la usa aún); Phase 2 depende de Phase 1 estar en prod.
- **No requiere cambios al index de features más allá de agregar la fila `028`.**
- **El `tasks.md` queda abierto** hasta que arranque la implementación; esta spec no lo genera.
