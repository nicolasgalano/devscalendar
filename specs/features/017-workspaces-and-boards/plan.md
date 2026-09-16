# Plan — Home, workspace por proyecto y tablero kanban

- **ID:** 017-workspaces-and-boards
- **Spec reference:** `./spec.md`
- **Estado:** ready
- **Depende de:** `015-project-membership-and-tickets`

---

## 1. Resumen técnico

**Cero migrations, cero policies, cero API routes, cero cambios en schema.** La feature son cuatro cosas:

- **Restructure de rutas**: `/` deja de ser `redirect('/calendar')` y pasa a ser una home con selector de producto. `/tickets` desaparece como listado (se muda a `/my-work`). Se crean `/projects` y `/projects/[projectKey]/{,backlog}`.
- **Componente `<KanbanBoard>`** nuevo, cliente, sobre `@dnd-kit/core` + `@dnd-kit/sortable`. Seis columnas de status, drag & drop + teclado, PATCH optimista con rollback en error usando `useOptimistic` y `router.refresh()`.
- **Componentes chicos**: `<ProjectList>` (tabla), `<ProjectWorkspaceHeader>` (breadcrumb + acciones + tabs), `<KanbanCard>` (tarjeta arrastrable), `<HomeDispatcher>` (home).
- **Update de `AppShell`**: renombrar "Tickets" a "Proyectos" apuntando a `/projects`; sumar "Mi trabajo" apuntando a `/my-work`; el logo top-left ya linkeaba a `/` — mantener.

El backend de `015` no se toca: el mismo `PATCH /api/tickets/[id]` que hoy usa el `<Select>` inline del detalle es el que va a disparar el drag del tablero.

### Decisiones heredadas del cuestionario

- **Nombre del ítem en sidebar:** "Proyectos" (no "Tickets").
- **Ticket detail:** flat en `/tickets/[ticketKey]` (no anidado).
- **Home:** sin ítem propio en sidebar; el logo del sidebar linkea a `/`.
- **Branch:** se comparte con `015-project-membership-and-tickets` — el mismo `feature/015-...`. Las commits llevan prefijo `017`.
- **Home = selector de producto** con dos cards (DevCalendar / Proyectos), no dashboard denso.
- **Kanban = drag & drop con `@dnd-kit`** (accesible por teclado por default).
- **Seis columnas siempre visibles** — sin toggle "esconder cerrados" en el tablero (el listado del backlog sí lo tiene, es la vista para eso).
- **`/tickets` global se muda a `/my-work`** — no se elimina el código, se mueve la ruta.

---

## 2. Rutas

```
/                            → src/app/(app)/page.tsx           — Home (selector de producto)
/calendar                     — sin cambios
/projects                    → src/app/(app)/projects/page.tsx  — listado de proyectos visibles
/projects/[projectKey]       → workspace, redirige a /projects/[projectKey]/board
/projects/[projectKey]/board  — tab tablero (default; ruta explícita para que el "active" del nav distinga)
/projects/[projectKey]/backlog — tab backlog
/tickets/[ticketKey]          — sin cambios (detalle flat de `015` T7.5)
/my-work                     → src/app/(app)/my-work/page.tsx   — la tabla vieja de `015` T7.2
/inbox                        — sin cambios
/admin/*                      — sin cambios
```

**Nota sobre `/projects/[projectKey]`:** en Next.js App Router, un `page.tsx` en la raíz del segmento y un sub-segmento `/board` son mutuamente excluyentes en la misma URL. Uso una `redirect('/projects/[projectKey]/board')` en el `page.tsx` de la raíz para que la URL canónica siempre incluya el tab — así el sidebar y los breadcrumbs pueden distinguir "tablero" de "backlog" mirando el path, no un query param.

**Nota sobre `[projectKey]` vs `[ticketKey]`:** la key del proyecto matchea `^[A-Z][A-Z0-9]{1,7}$` (sin guión ni número); la key de ticket es `PROJ-N`. Sin ambigüedad. La validación en `parseTicketKey` (que ya existe) tira null para keys de proyecto — necesitamos un `parseProjectKey` análogo, que ya se puede escribir sobre el mismo regex ampliado.

---

## 3. Estructura de archivos nuevos y modificados

```
NUEVOS:
  src/app/(app)/page.tsx                              (redirect → home)  ← reemplaza el redirect actual a /calendar
  src/app/(app)/projects/page.tsx
  src/app/(app)/projects/loading.tsx
  src/app/(app)/projects/[projectKey]/page.tsx       (redirect al tab board)
  src/app/(app)/projects/[projectKey]/layout.tsx     (shell del workspace con tabs)
  src/app/(app)/projects/[projectKey]/board/page.tsx
  src/app/(app)/projects/[projectKey]/board/loading.tsx
  src/app/(app)/projects/[projectKey]/backlog/page.tsx
  src/app/(app)/projects/[projectKey]/backlog/loading.tsx
  src/app/(app)/my-work/page.tsx                     (mueve el código de tickets/page.tsx)
  src/app/(app)/my-work/loading.tsx

  src/components/home-dispatcher.tsx                 (cards del selector de producto)
  src/components/projects/project-list.tsx           (tabla de proyectos)
  src/components/projects/project-workspace-header.tsx (breadcrumb + acciones + tabs)
  src/components/projects/kanban-board.tsx           (tablero kanban con dnd-kit)
  src/components/projects/kanban-column.tsx
  src/components/projects/kanban-card.tsx

  src/lib/projects/keys.ts (extender)                (agregar parseProjectKey si no existe)
  src/lib/projects/workspace.ts                      (queries: getProjectByKey, getProjectTicketsForBoard)

MODIFICADOS:
  src/components/app-shell.tsx                       (rename "Tickets" → "Proyectos"; sumar "Mi trabajo"; sacar link del ticket global viejo)
  src/lib/tickets/query.ts                           (pasa `projectId` como filtro adicional a getTicketsList — para el backlog)
  src/components/tickets/ticket-list-filters.tsx     (esconder el select de proyecto cuando ya está scoped)
  src/components/tickets/create-ticket-button.tsx    (aceptar `defaultProjectId` desde el workspace)

BORRADOS:
  src/app/(app)/tickets/page.tsx                     (se mudó a /my-work)
  src/app/(app)/tickets/loading.tsx                  (idem)
```

---

## 4. Home (`/`)

Server component. La navegación autenticada vive en el shell (sidebar + topbar), así que la home es solo el contenido del área central.

Layout:

```
+--------------------------------------------------+
|  Elegí a dónde ir                                |
+--------------------------------------------------+
|  +---------------------+   +-------------------+ |
|  |  📅  DevCalendar    |   |  ☑  Proyectos     | |
|  |  Ver y editar la    |   |  Ver los tickets  | |
|  |  agenda del equipo  |   |  por proyecto     | |
|  +---------------------+   +-------------------+ |
+--------------------------------------------------+
```

- Sin hero, sin emojis (los iconos van con Lucide: `CalendarDaysIcon`, `FolderKanbanIcon`).
- Cards con `border-border`, sin sombra, radius 6px. Hover levanta `bg-surface-hover`. Focus outline como el resto.
- Ancho del contenido: **acá sí se rompe la regla de ancho completo de `DESIGN.md` §6** — el contenido va contenido a `max-w-3xl` centrado, porque un dispatcher pegado al ancho de la pantalla se lee como error de layout. Documentado como excepción en `DESIGN.md` §14 al terminar.
- Un tercer card **"Administración" → `/admin`** aparece solo si `isAdmin(profile.roles)`.
- Un cuarto card **"Bandeja" → `/inbox`** aparece solo si `isDeveloper(profile.roles)`.

`getCurrentProfile()` para decidir qué cards mostrar — ya está memorizado por request.

---

## 5. `/projects` (listado)

Server component. Query única: `select id, key, name, active, client:clients(name), pm:profiles(full_name)` desde `projects` con RLS. Suma un `count` de tickets abiertos por proyecto vía sub-select o segunda query — para 6 usuarios y ~15 proyectos, una segunda query filtrada por `project_id IN (...)` con `status = ANY(TICKET_STATUS_OPEN)` alcanza y es leíble.

Tabla:

| KEY | Proyecto | Cliente | PM | Estado | Tickets abiertos |
|-----|----------|---------|-----|--------|-------------------|
| WDW | White Label WDW | Nimbus | Nico | Activo | 12 |
| DEV | DevsCalendar | Interno | Nico | Activo | 4 |
| OLD | Proyecto viejo | Ex Cliente | María | Inactivo | 2 |

- Fila clickeable → `/projects/[projectKey]`. Fila inactiva en `text-muted-foreground`.
- Empty state: reusa el patrón de `/tickets` — "Todavía no sos miembro de ningún proyecto".

---

## 6. Workspace del proyecto (`/projects/[projectKey]`)

`layout.tsx` es el shell compartido entre `/board` y `/backlog`:

- **Header** con breadcrumb "Proyectos › <Nombre>", KEY en `.font-data`, cliente, PM.
- **Botón "Crear ticket"** en el header, que abre el mismo `<TicketFormDialog>` de `015` T7.7 preseleccionando el proyecto actual (via `defaultProjectId`).
- **Tabs**: "Tablero" | "Backlog", cada una un `<Link>` con `aria-current="page"` en la activa. La determinación de activo por segmento (`board` o `backlog` en el path).
- El children del layout renderiza uno u otro.

`page.tsx` de la raíz del segmento hace `redirect('/projects/[projectKey]/board')` — el activo del nav siempre distingue.

**Datos del proyecto:** una sola query `getProjectByKey(projectKey)` en el layout, cacheada por request (React `cache()`). Los dos tabs la reusan sin re-fetchear.

Si el proyecto no existe (RLS lo filtra o clave inválida) → `notFound()`.

---

## 7. Tab Tablero — `<KanbanBoard>`

Cliente puro. Recibe:

```ts
type KanbanBoardProps = {
  projectId: string;
  projectKey: string;
  tickets: TicketListItem[];  // los tickets del proyecto, ya cargados
  viewer: { id: string; roles: UserRole[] } | null;
  roleInProject: ProjectRole | null;
};
```

Layout: `flex gap-4 overflow-x-auto` con seis columnas del ancho fijo (240px cada una), scroll horizontal por debajo del breakpoint del sidebar (1024px). Alturas: `min-h-96`, `max-h-[calc(100vh-16rem)]`, cada columna scrollea independientemente.

### Estructura interna

```
<KanbanBoard>
  <DndContext ...>
    <div className="flex gap-4">
      <KanbanColumn status="todo" tickets={grouped.todo}>
        <SortableContext items={grouped.todo.map(t=>t.id)}>
          <KanbanCard ticket={t} draggable={canChangeTicketStatus(...)} />
          <KanbanCard ... />
        </SortableContext>
      </KanbanColumn>
      ... 5 columnas más
    </div>
    <DragOverlay>
      {activeTicket && <KanbanCard ticket={activeTicket} isDragging />}
    </DragOverlay>
  </DndContext>
</KanbanBoard>
```

### PATCH optimista con rollback

```ts
const [optimisticTickets, setOptimistic] = useOptimistic(tickets);

function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  if (!over) return;
  const ticketId = active.id as string;
  const toStatus = over.data.current?.status as TicketStatus;
  const ticket = optimisticTickets.find(t => t.id === ticketId);
  if (!ticket || ticket.status === toStatus) return;

  // 1. Optimistic: reflejo el cambio al instante.
  startTransition(() => setOptimistic(prev =>
    prev.map(t => t.id === ticketId ? { ...t, status: toStatus } : t)
  ));

  // 2. Server: fire-and-await; router.refresh() al finalizar (ok o error).
  fetch(`/api/tickets/${ticketId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: toStatus }),
  })
    .then(async res => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.reason ?? body.error ?? "No se pudo mover el ticket.");
      }
    })
    .catch(() => setError("No se pudo conectar con el servidor."))
    .finally(() => router.refresh());
}
```

**El `router.refresh()` en `finally` es la red de seguridad:** si el server rechaza, el rerender trae la data real y el optimista se descarta; si el server acepta, el rerender confirma el estado y el optimista se convierte en canon.

### Permisos por tarjeta

- `canChangeTicketStatus(viewer, project, roleInProject)` determina si la tarjeta es arrastrable.
- Las no-arrastrables tienen `cursor: default`, `aria-disabled="true"`, y `sortableProps.disabled = true` en `useSortable()`. El keyboard sensor también las salta.

### Sensores

- `PointerSensor` con `activationConstraint: { distance: 6 }` — un click sin drag no dispara el sortable.
- `KeyboardSensor` con `sortableKeyboardCoordinates` — accesibilidad por default.

---

## 8. Tab Backlog — reuso de `<TicketList>`

Server component. Llama a `getTicketsList({ projectId, ...filters }, viewerId)` con el `projectId` del layout. Reusa `<TicketList>` sin modificar y `<TicketListFilters>` con una prop nueva `hideProjectFilter` para esconder el select de proyecto (redundante).

Empty state: el mismo `<EmptyState>` con "Sin tickets en este proyecto" / CTA "Crear ticket".

---

## 9. Sidebar — `<AppShell>`

Cambios mínimos:

```ts
// antes (015 T7.1):
{ href: "/tickets", label: "Tickets", Icon: TicketIcon }

// después (017):
{ href: "/projects", label: "Proyectos", Icon: FolderKanbanIcon }

// nuevo item, después de "Proyectos":
{ href: "/my-work", label: "Mi trabajo", Icon: ListChecksIcon }
```

- El logo/nombre del top-left del sidebar ya linkea a `/` (`app-shell.tsx:216`) — se conserva.
- `FolderKanbanIcon` ya está importado (lo usa "Proyectos" en Admin). Se puede compartir sin problema — el `matchesPath` distingue `/projects` (nuevo, ítem principal) de `/admin/projects` (item admin) porque el path de admin arranca con `/admin/`.
- `ListChecksIcon` de Lucide para "Mi trabajo".

**La determinación de activo** (`matchesPath`) sigue por segmento — `/projects/WDW-1/board` mantiene activo "Proyectos", `/tickets/WDW-1` mantiene activo… nada específicamente. Un ticket abierto directo no pertenece a ningún grupo del sidebar; el activo queda apagado. Es un pequeño gap pero no vale la pena resolverlo — cuando venís del backlog, sabés que estás mirando un ticket de un proyecto; el breadcrumb del detalle podría linkear "volver a Proyectos", cosa que ya hace hoy pero apunta a `/tickets` (línea `TicketDetail`, "Volver a tickets"). **Ajustar ese link a `/projects` como parte de esta feature.**

---

## 10. Dependencias npm

```
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- `@dnd-kit/core`: `DndContext`, sensores, `DragOverlay`.
- `@dnd-kit/sortable`: `SortableContext`, `useSortable`, `sortableKeyboardCoordinates`.
- `@dnd-kit/utilities`: `CSS.Transform.toString` para el estilo del drag.

Todos son ES modules puros, sin dependencias externas grandes. `~30KB` combinados gzipped, cargados **solo** en el componente `<KanbanBoard>` (cliente).

---

## 11. Riesgos y mitigaciones

- **R-1 (spec) — Departure de `DESIGN.md`**: la home rompe "no landing" y el `max-w-3xl` rompe "sin ancho máximo". **Mitigación:** documentar como excepción en `DESIGN.md` §14 al cerrar la feature; el resto de la app conserva la regla.
- **R-2 (spec) — Optimista + rollback**: `router.refresh()` en `finally` es la ancla de sincronización.
- **R-3 (spec) — Accesibilidad**: DoD incluye probar el tablero con teclado, verificar que `KeyboardSensor` mueve tarjetas entre columnas.
- **R-4 (plan) — Contradicción de `[projectKey]` con `[ticketKey]`**: no aplica en la práctica porque viven en segmentos distintos (`/projects/WDW` vs `/tickets/WDW-1`). Anotado por si el futuro tienta a colapsarlos.
- **R-5 (plan) — RLS y el count de tickets**: si un usuario ve un proyecto pero no puede ver *ningún* ticket dentro (edge case improbable con las policies actuales), el count queda en 0 pero el proyecto aparece. Es correcto.

---

## 12. Testing

- **Unit** (Vitest): parseProjectKey/formatProjectKey (una función pura), decisión de si un movimiento kanban es válido (opcional — la verdad la tiene el trigger, pero el reducer del optimista podría tener su test).
- **Integración**: N/A — no hay cambios de RLS ni de API.
- **Smoke**: N/A por lo mismo.
- **E2E** (Playwright, opcional en `017`): un happy path — logueado, home → Proyectos → workspace → tablero → arrastrar tarjeta → detalle. Se puede escribir después del deploy de la feature.
- **Manual**: DoD de cada task lo especifica.

---

## 13. Cierre

Al terminar:

1. Actualizar `specs/features/README.md` sumando `017` como `done`.
2. Actualizar `DESIGN.md` §14 documentando la excepción del home landing y del `max-w-3xl`.
3. Actualizar `CLAUDE.md` sección "Estado de features" con `017` en done y la nueva descripción del `/` y del sidebar.
4. Verificación visual del usuario en el navegador — la regla del proyecto que dispara el DoD final de toda feature con vistas.
