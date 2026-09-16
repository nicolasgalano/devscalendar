# Spec — Home, workspace por proyecto y tablero kanban

- **ID:** 017-workspaces-and-boards
- **Estado:** draft
- **Referencias en la spec funcional:** §4 (calendario, se conserva), §11 (roles), y `015` (tickets + membresías, sobre la que se apoya)

---

## 1. Objetivo

Reorganizar la navegación de la app para que la primera pantalla no sea el calendario, sino una **home** con dos entradas (**DevCalendar** y **Proyectos**), y montar sobre `015` el modelo de trabajo por proyecto: entrás al proyecto, elegís entre **Tablero** (kanban por estado) o **Backlog** (lista), y arrastrás los tickets entre columnas del tablero.

El listado global de tickets que `015` T7.2 dejó en `/tickets` se conserva como vista personal ("Mi trabajo") — sigue habiendo un lugar donde ver "todo lo mío" cross-project.

---

## 2. Contexto

`015` cerró la parte transaccional de tickets (RLS, API, permisos, notificaciones, listado global filtrable, detalle). Lo que quedó es un `/tickets` que es una tabla plana: útil, pero no organiza el trabajo por proyecto, y el usuario cae directo al calendario al loguearse aunque hoy quiera ver sus tickets.

La familiaridad con Jira del equipo pide un modelo distinto: primero elegís **producto** (calendario o tickets), después el **proyecto** dentro del producto de tickets, y ahí adentro tenés el flujo visual (tablero) o el de lista (backlog). Es el patrón que la gente ya sabe operar.

Este cambio **no** toca RLS, ni policies, ni API — es puramente frontend y ruteo. El backend de `015` cubre todo lo que necesita.

---

## 3. User stories

- **US-1 · Home** — Como usuario, al loguearme quiero una pantalla que me deje elegir a qué parte de la app entro (calendario o tickets), en vez de caer siempre en el calendario. La primera visita del día casi nunca es la misma que la anterior.
- **US-2 · Proyectos como raíz de tickets** — Como usuario del sistema de tareas, quiero ver primero los proyectos de los que soy miembro (o del que soy admin/PM), y entrar a cada uno. Ver 200 tickets sueltos de 12 proyectos distintos no me organiza el día; ver 12 proyectos sí.
- **US-3 · Tablero kanban** — Como miembro de un proyecto, quiero ver sus tickets en columnas por estado, y arrastrar una tarjeta a otra columna para moverla de estado. Es el mismo cambio de status que hoy hago con el dropdown del detalle, pero de un vistazo sobre 30 tickets.
- **US-4 · Backlog** — Como miembro de un proyecto, quiero un tab de "Backlog" con los tickets del proyecto en formato lista/tabla, con los mismos filtros que hoy tiene el listado global. El tablero es para el flujo, la lista es para leer y buscar.
- **US-5 · Mi trabajo** — Como usuario, quiero un lugar que me muestre **todos** mis tickets abiertos cross-project (los que creé y los que me asignaron). Es la vista que hoy es `/tickets`; se mueve a `/my-work` pero no se pierde.

---

## 4. Acceptance criteria

### US-1 · Home

- **AC-1.1** — Given un usuario autenticado con rol asignado, when abre `/`, then ve una pantalla con dos elementos de navegación primaria — **DevCalendar** → `/calendar`, y **Proyectos** → `/projects` — más un tercero condicional a rol (**Admin** → `/admin` para admins). Sin hero decorativo, sin secciones adicionales, densidad consistente con `DESIGN.md`.
- **AC-1.2** — La home **no aparece como ítem del sidebar**. El logo/nombre del top-left del sidebar linkea a `/` — es el único acceso.
- **AC-1.3** — Given un usuario sin rol (nuevo, esperando alta), when abre `/`, then el flujo del middleware ya lo manda a `/pending-access` — la home no lo ve.

### US-2 · `/projects` como raíz del sistema de tickets

- **AC-2.1** — Given un usuario autenticado abre `/projects`, when la vista carga, then ve una **lista de proyectos** — todos los que la RLS de `projects` le permite ver (admin ve todos, PM ve los suyos, miembro ve donde es miembro).
- **AC-2.2** — Cada card/fila del listado muestra: `KEY`, nombre del proyecto, cliente, y **contador de tickets abiertos** (los que están en un estado de `TICKET_STATUS_OPEN`). Click abre `/projects/[projectKey]`.
- **AC-2.3** — Empty state: si el usuario no es miembro de ningún proyecto y no es admin/PM de ninguno, ve el mismo cartel que en `015` T7.2 — "Todavía no sos miembro de ningún proyecto", sin CTA.
- **AC-2.4** — Los proyectos **inactivos** aparecen en el listado con tratamiento visual atenuado (mismo criterio que hoy tiene `/admin/projects`), no ocultos — sus tickets viejos siguen accesibles.
- **AC-2.5** — El ítem del sidebar cambia de nombre a **"Proyectos"** (hoy es "Tickets" por `015` T7.1) y su href pasa a ser `/projects`.

### US-3 · Tablero kanban en `/projects/[projectKey]`

- **AC-3.1** — Given un miembro del proyecto abre `/projects/[projectKey]`, when la vista carga, then el tab por default es **Tablero**, con **seis columnas** — una por estado (`todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`) — y las tarjetas de tickets del proyecto agrupadas en su columna.
- **AC-3.2** — Cada tarjeta muestra: `KEY` en `.font-data`, título, badge de prioridad, avatar del asignado (o "Sin asignar"). Click en la tarjeta abre el detalle en `/tickets/[ticketKey]`.
- **AC-3.3** — Given una tarjeta y un usuario con permiso para cambiar su estado (`canChangeTicketStatus`), when el usuario la **arrastra** de una columna a otra y la suelta, then se dispara un `PATCH /api/tickets/[id]` con el nuevo status. El movimiento es optimista.
- **AC-3.4** — Si el server rechaza el PATCH (403 por trigger de contributor-scope, 409 por otra razón), la tarjeta **vuelve a su columna original** y se muestra el motivo del error como toast/mensaje inline. El estado real del server nunca queda desincronizado del pintado.
- **AC-3.5** — Para usuarios sin permiso para cambiar el status de una tarjeta, esa tarjeta **no es arrastrable** (cursor y aria lo comunican) — pero sigue siendo clickeable para abrir el detalle. La verdad la impone el trigger del server; esto es UX.
- **AC-3.6** — El tablero es **accesible por teclado**: `Tab` recorre las tarjetas, `Space`/`Enter` la agarra, flechas la mueven entre columnas, `Space`/`Enter` la suelta. El sensor de teclado de `@dnd-kit` cubre esto por default.
- **AC-3.7** — Cuando una columna está vacía, muestra un placeholder discreto (`Sin tickets en <estado>`) — sin CTA, para no duplicar el botón "Crear ticket" del header.

### US-4 · Backlog en `/projects/[projectKey]/backlog`

- **AC-4.1** — Given un miembro del proyecto abre el tab **Backlog** (`/projects/[projectKey]/backlog`), when la vista carga, then ve una **tabla** con los tickets del proyecto — misma tabla que `015` T7.3 (`<TicketList>`), pero acotada por `projectId` implícito y **sin filtro de proyecto** (redundante en este contexto).
- **AC-4.2** — El resto de los filtros (estado, asignado, prioridad, búsqueda por título, toggle "Incluir cerrados") funciona igual que en `/my-work`, con el estado en la URL.
- **AC-4.3** — El default de estado sigue siendo `TICKET_STATUS_OPEN` (los cuatro abiertos), como en `015`.

### US-5 · Mi trabajo

- **AC-5.1** — Given el path viejo `/tickets` era el listado global de `015` T7.2, when se aplica esta feature, then la tabla se **mueve** a `/my-work` con los mismos filtros y comportamiento. `/tickets` como path **deja de existir** como listado — si alguien va ahí, obtiene el mismo 404 que cualquier otra ruta desconocida (no hacemos redirect porque la app no está deployada aún, no hay bookmarks reales que preservar).
- **AC-5.2** — El sidebar suma un ítem **"Mi trabajo"** → `/my-work` (icono a definir en `plan.md`), visible para todo autenticado. Empty state igual al de `015` T7.2.
- **AC-5.3** — El detalle de ticket sigue en `/tickets/[ticketKey]` (**flat**, sin anidar en `/projects/[projectKey]/[ticketKey]`). Los links de notificaciones por email (`010`) ya apuntan ahí y no se rompen.

---

## 5. Alcance

**Dentro:**
- Home (`/`) con selector de producto.
- Listado de proyectos (`/projects`) con RLS filtrando membresía.
- Workspace de proyecto (`/projects/[projectKey]`) con tabs **Tablero** y **Backlog**.
- Tablero kanban con `@dnd-kit`, seis columnas, drag & drop + teclado, PATCH optimista con rollback en error.
- Backlog como reuso de `<TicketList>` scoped por proyecto.
- Mudanza del listado global de `/tickets` a `/my-work`.
- Update de nav en `AppShell`: renombrar "Tickets" a "Proyectos", agregar "Mi trabajo", logo linkea a `/`.

**Fuera:**
- Configuración de columnas por proyecto (F3 de `015` seguía como fuera-de-scope; sigue siéndolo).
- Swimlanes en el tablero (agrupación por asignado, por prioridad, etc.).
- Reordenamiento dentro de una columna (orden manual persistido) — el orden es por `updated_at desc` como en el listado.
- Cambios de RLS, policies, API o schema.
- Redirect de `/tickets` viejo → `/my-work`. Como la app no está deployada, no hay bookmarks reales.
- Cambios al detalle de ticket (`/tickets/[ticketKey]`), que sigue igual que `015` T7.5/T7.6.

---

## 6. Preguntas abiertas

- **Q-1** — El listado de proyectos, ¿ordena por nombre o por "actividad reciente" (max `updated_at` de tickets del proyecto)? Actividad reciente es más útil pero suma una query. **Default aplicado en plan:** por nombre alfabético para MVP; se puede iterar.
- **Q-2** — Cuando el usuario está en el tab "Tablero" y filtra por asignado/prioridad, ¿los filtros se conservan al cambiar al tab "Backlog"? Sí — el estado vive en la URL y ambos tabs consumen los mismos filtros. **Aplicado en plan.**
- **Q-3** — ¿La home muestra algún dato del usuario (nombre, avatar, "hola X")? Yo diría que **no**: es un dispatcher, no un dashboard. Se puede iterar si el equipo lo pide.
- **Q-4** — El listado de proyectos, ¿es tabla o cards? Con densidad al estilo `/admin/projects` es tabla; con densidad al estilo Jira portal es cards. **Default en plan:** tabla, coherente con el resto de `/admin/*` y con la densidad de `DESIGN.md`.

---

## 7. Riesgos

- **R-1 · Departure de `DESIGN.md`.** §1 dice "no es un sitio web, no hay hero, no hay contenedor centrado". La home rompe eso — es un dispatcher con dos cards centradas. **Mitigación:** documentar la excepción explícitamente en `DESIGN.md` §14 al terminar la feature, igual que se hizo con la paleta categórica del calendario (§2). El resto de la app sigue la regla.
- **R-2 · Optimista + rollback bien implementado.** El drag optimista con rollback en error requiere código bien pensado — si el rollback falla o se pierde una respuesta, la card queda en la columna equivocada y el usuario no lo nota. **Mitigación:** `router.refresh()` después de cada PATCH (éxito o error) fuerza la re-sincronización con el server como red de seguridad; el optimista es solo para el "sentir bien" del drag.
- **R-3 · Drag & drop y accesibilidad.** Muchas implementaciones de kanban rompen el teclado. **Mitigación:** `@dnd-kit` trae `KeyboardSensor` por default; el test manual con teclado antes de dar la feature por terminada es parte del DoD (checklist DESIGN.md §12).
- **R-4 · Rutas viejas de `015`.** El commit que abre esta feature va a mover `/tickets` a `/my-work`. Si en el medio alguien probó a mano y guardó un bookmark, se rompe. La app no está deployada (`CLAUDE.md` "Estado: en desarrollo"), así que el impacto es cero — pero conviene decirlo.
- **R-5 · Bundle size.** `@dnd-kit/core` + `@dnd-kit/sortable` son ~30KB gzipped. Solo se carga en la ruta del tablero (dynamic import + client component). **Mitigación:** import estático en el componente de tablero, que ya es cliente puro; no llega al bundle del layout ni de otras rutas.

---

## 8. Dependencias

- **015-project-membership-and-tickets** — necesita estar mergeado (o al menos con Phases 1–7 en la misma rama, que es el caso). La feature usa `getTicketsList`, `getTicketByKey`, `<TicketList>`, `<TicketFormDialog>`, `<TicketStatusBadge>`, `<TicketPriorityBadge>`, `PATCH /api/tickets/[id]` — todo eso lo cerró `015`.
- **NO depende** de `010` (notifications) ni de nada más allá de `015`.

---

## 9. Compatibilidad con features futuras

- **016-time-tracking** — cuando aterrice, cargar horas contra un ticket va a vivir naturalmente en `/tickets/[ticketKey]` (detalle) y quizás en el tablero como un badge de "X h cargadas". Nada de lo que se agrega acá bloquea eso.
- **007-google-calendar / 008-jira / 009-slack** — no tocan tickets ni navegación; conviven.
