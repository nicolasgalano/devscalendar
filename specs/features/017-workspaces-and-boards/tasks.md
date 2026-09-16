# Tasks — Home, workspace por proyecto y tablero kanban

- **ID:** 017-workspaces-and-boards
- **Plan reference:** `./plan.md`
- **Spec reference:** `./spec.md`
- **Estado:** done — 2026-09-16

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

Fases:

- **Fase A — Restructure de rutas + home** (T1.1 – T1.5)
- **Fase B — `/projects` listado + workspace** (T2.1 – T2.4)
- **Fase C — Kanban board** (T3.1 – T3.5)
- **Fase D — Backlog y cierre** (T4.1 – T4.4)

---

## Fase A — Restructure de rutas + home

- [x] **T1.1** — `<HomeDispatcher roles />` en `src/components/home-dispatcher.tsx` (server-safe). Cuatro cards potenciales: **DevCalendar**, **Proyectos**, **Bandeja** (si `isDeveloper`), **Administración** (si `isAdmin`, a `/admin/clients` que es el primer sub-item). Iconos Lucide, sin hero, borde `--border`, radius 6px. `max-w-3xl` centrado — excepción documentada. Grid `sm:grid-cols-2`.
- [x] **T1.2** — `src/app/(app)/page.tsx` pasa a resolver `getCurrentProfile()` y renderizar `<HomeDispatcher roles={profile.roles} />`. El `redirect('/calendar')` viejo desapareció.
- [x] **T1.3** — Listado global mudado: nuevo `src/app/(app)/my-work/page.tsx` (renombrado de `TicketsPage` a `MyWorkPage`, título "Mi trabajo", descripción "Todos tus tickets abiertos, cross-project.") + `my-work/loading.tsx`. Borrados `src/app/(app)/tickets/page.tsx` y `tickets/loading.tsx`. **Extra**: `TICKETS_PATH` en `src/lib/tickets/url.ts` pasó de `/tickets` a `/my-work` para que `buildTicketsHref`/`clearTicketFiltersHref` devuelvan el nuevo default. Los helpers ganaron un segundo parámetro opcional `basePath` para que el backlog scoped por proyecto pueda construir sus propios hrefs con `/projects/[key]/backlog` sin duplicar el helper (adelantado desde T4.3). `<TicketListFilters>` acepta `basePath` y `hideProjectFilter` como props opcionales.
- [x] **T1.4** — `AppShell`: se removió el ítem "Tickets" (con `TicketIcon`) y se agregaron dos: **Proyectos** → `/projects` con `FolderKanbanIcon`, y **Mi trabajo** → `/my-work` con `ListChecksIcon`. Comentarios en el código explican el rename. El logo del top-left (`app-shell.tsx:216`) sigue apuntando a `/` sin cambios — es el único acceso a la home.
- [x] **T1.5** — `<TicketDetail>` `"← Volver a tickets"` → `"← Volver al proyecto"` linkeando a `/projects/[projectKey]/board`. Es una vuelta más útil que el listado general — el usuario venía de un tablero o backlog específico.

---

## Fase B — `/projects` listado + workspace

- [x] **T2.1** — `parseProjectKey(input)` agregado a `src/lib/projects/keys.ts`. Regex `^[A-Za-z][A-Za-z0-9]{1,7}$`, case-insensitive, mayúsculas canónicas en el output. Nunca tira; devuelve `null` ante input inválido. Sin `formatProjectKey` — el `key` de un proyecto **ya es** su forma canónica (mayúsculas), a diferencia del ticket que se compone con `-N`.
- [x] **T2.2** — `getVisibleProjects()` en `src/lib/projects/workspace.ts`: cacheada por request. **Más restrictiva que la RLS**: admin ve todo, no-admin ve donde es PM primario **o** miembro activo (la RLS de `projects` sigue siendo `has_any_role()` para no romper el calendario). Dos queries: proyectos con embeds + `project_id, id.count()` sobre tickets en `TICKET_STATUS_OPEN`. Orden alfabético (Q-1 default).
- [x] **T2.3** — `<ProjectList projects />` en `src/components/projects/project-list.tsx`. Tabla `Clave | Proyecto | Cliente | PM | Estado | Tickets abiertos`. Filas clickeables → `/projects/[key]/board`. Inactivos en `text-muted-foreground`. Reusa `<RecordStatus>` para la columna Estado.
- [x] **T2.4** — `src/app/(app)/projects/page.tsx` + `loading.tsx`. Header "Proyectos", descripción "Elegí un proyecto para ver su tablero o su backlog." Empty state "Todavía no participás en ningún proyecto".

---

## Fase B (cont) — Workspace del proyecto

- [x] **T2.5** — `getProjectByKey(rawKey)` en `src/lib/projects/workspace.ts`. Parsea la key, respeta RLS, devuelve `null` en cualquiera de los tres casos (parseo, existencia, visibilidad). Resuelve `role_in_project` vía RPC.
- [x] **T2.6** — `<ProjectWorkspaceHeader project projectFacets membersByProject />` en `src/components/projects/project-workspace-header.tsx`. Cliente para poder leer `usePathname()` y marcar la tab activa. Breadcrumb "Proyectos › KEY", nombre + `(inactivo)` cuando corresponde, cliente y PM en meta. `<CreateTicketButton>` con `defaultProjectId` — solo si el proyecto está activo (los inactivos no aceptan tickets nuevos por AC-2.5 de `015`). Tabs "Tablero" | "Backlog" como `<Link>` con `aria-current="page"`.
- [x] **T2.7** — `src/app/(app)/projects/[projectKey]/layout.tsx`. `getProjectByKey` + `notFound()`. Trae `getTicketFacets()` para alimentar el `<CreateTicketButton>` del header. Renderiza header + `{children}`.
- [x] **T2.8** — `src/app/(app)/projects/[projectKey]/page.tsx`: `redirect(`/projects/${projectKey}/board`)`.

---

## Fase C — Kanban board

- [x] **T3.1** — `pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`. Typecheck + lint + 216 unit tests verdes.
- [x] **T3.2** — `<KanbanCard ticket draggable isOverlay />` en `src/components/projects/kanban-card.tsx`. `useSortable` con `disabled: !draggable`. Link al detalle con `draggable={false}` para desactivar el drag nativo de link del browser (que confunde a dnd-kit). Cuando `sortable.isDragging`, la card original queda `opacity-30`; el `DragOverlay` muestra la "flotante" con `shadow-lg`.
- [x] **T3.3** — `<KanbanColumn status tickets canDrag />` en `src/components/projects/kanban-column.tsx`. `useDroppable` con `data: { status }` — así el `handleDragEnd` del board sabe a qué estado se soltó. `SortableContext` con `verticalListSortingStrategy` (aunque no persistimos el orden dentro de columna — F1). Ring `--primary` cuando `droppable.isOver`. Placeholder italic "Sin tickets en <estado>" cuando vacía.
- [x] **T3.4** — `<KanbanBoard tickets viewer project roleInProject />` en `src/components/projects/kanban-board.tsx`. `useOptimistic` para el rerender inmediato, `PointerSensor(distance:6)` + `KeyboardSensor(sortableKeyboardCoordinates)`, `router.refresh()` en `finally` (éxito o error) como ancla — si el server rechaza, el rerender descarta el optimista, sin código de rollback. `handleDragEnd` acepta drop sobre columna o sobre tarjeta. `DragOverlay` con la tarjeta arrastrada. Permiso a nivel proyecto (`canChangeTicketStatus` no depende del ticket individual): se computa una vez y se pasa como `() => boolean` — firma preparada por si mañana la regla se hace por-ticket.
- [x] **T3.5** — `src/app/(app)/projects/[projectKey]/board/page.tsx` + `loading.tsx`. Llama a `getTicketsList` con **los seis estados** (decisión "6 siempre visibles"). Pasa `project`, `viewer`, `roleInProject` al `<KanbanBoard>`. Skeleton con tres columnas placeholder.

---

## Fase D — Backlog y cierre

- [x] **T4.1** — Adoptado el enfoque "merge en la page": `backlog/page.tsx` llama a `parseTicketFilters(raw)` y sobreescribe `projectId` con el fijo del path antes de pasar a `getTicketsList`. Así `?projectId=<otro>` en el URL no rompe el scope, y no hace falta cambiar `getTicketsList`.
- [x] **T4.2** — `src/app/(app)/projects/[projectKey]/backlog/page.tsx` + `loading.tsx`. Header ya lo puso el layout; acá van los filtros + tabla. `NoResultsState` cuando hay filtros que no matchean (nombra proyecto explícitamente); `EmptyState` cuando el proyecto no tiene tickets todavía (sin CTA — el "Crear ticket" ya vive en el header del workspace, evita duplicar).
- [x] **T4.3** — Prop `hideProjectFilter?: boolean` agregada a `<TicketListFilters>` en Fase A (adelantada junto con `basePath`). Aplicada en `backlog/page.tsx`.
- [x] **T4.4** — El header del workspace pasa `defaultProjectId={project.id}` al `<CreateTicketButton>`. El botón preselecciona el proyecto en el dialog.

---

## Fase D (cont) — Cierre

- [x] **T4.5** — `DESIGN.md` §14 actualizado: se sumó una entrada para `015` (kanban como sistema de estado + prioridad de ticket estirada a 4 niveles sin agregar tokens) y otra para `017` con las tres excepciones documentadas (home dispatcher con `max-w-3xl`, home fuera del sidebar, tabs del workspace). También queda anotado el sync indicator flotante como infra transversal, con su spec de animación / accesibilidad.
- [x] **T4.6** — `specs/features/README.md` actualizado: se sumaron filas `015` (en progreso — Phases 1–7 en producción, 8–10 abiertas), `016` (draft) y `017` (done).
- [x] **T4.7** — `CLAUDE.md` actualizado:
  - **Estructura del repo**: nuevas subrutas de `(app)/` (projects/board/backlog/my-work) y nuevas carpetas de `components/` y `lib/` (tickets, projects, markdown, home-dispatcher, sync-indicator).
  - **Estado de features**: se corrigió el header "en desarrollo" (que decía "features 001 a 006, 010 y 011"), se sumaron `015` (en progreso con Phases 8–10 abiertas) y `017` (done). Nota completa sobre `015` incluye el bug de la migration 15 y su follow-up F6.
  - **Rutas y permisos**: cuatro bullets nuevos sobre home dispatcher (acceso por logo del sidebar, ningún nav item activo cuando estás ahí), sistema de tareas por proyecto (`/projects` puerta, `[projectKey]/layout.tsx` con `getProjectByKey()` cacheada, `page.tsx` redirect al tab board, detalle flat en `/tickets/[key]`), y regla de usar `useSyncIndicator()` en vez de local savingCount.
- [x] **T4.8** — **Verificación visual del usuario en el browser confirmada** (2026-09-16): home renderiza cards según rol, `/projects` lista proyectos con conteo de tickets abiertos, workspace muestra Tablero + Backlog, drag & drop persiste el status y la card queda en la columna nueva sin flash, error de trigger `jsonb - jsonb` reparado con migration 15, sync indicator aparece bottom-right al arrastrar. Queda pendiente cleanup de eventuales datos de prueba (`[test:<runId>]`) cuando se hayan creado tickets de testing.

---

## Blocked / follow-ups

- [ ] **F1 — Ordenamiento dentro de columna del tablero.** Hoy el orden es `updated_at desc`, sin persistir orden manual. Si el equipo pide "arrastrar dentro de la misma columna para priorizar", se agrega una columna `board_position` a `tickets` y `SortableContext` maneja el `handleDragEnd` con reorder. Fuera de scope de MVP.
- [ ] **F2 — Swimlanes.** Agrupar tarjetas por asignado, prioridad o cliente en el tablero. Útil cuando un proyecto tiene 60+ tickets abiertos. Fuera de scope; se pide cuando duele.
- [ ] **F3 — Configuración de columnas por proyecto.** Diferentes proyectos podrían querer omitir `in_review` o agregar otros estados. Sigue como F3 de `015` — cuando aparezca la necesidad concreta.
- [ ] **F4 — Actividad reciente en `/projects`.** Ordenar por "última actividad" (max `updated_at` de tickets del proyecto) requiere una query extra. Iterable si el equipo pide.
- [ ] **F5 — Redirect `/tickets` → `/my-work`.** Cuando la app se deploye y haya bookmarks o emails viejos que apuntan a `/tickets`, se agrega el redirect. Hoy no vale la pena — nadie tiene bookmarks todavía.
