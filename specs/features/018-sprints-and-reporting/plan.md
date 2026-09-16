# Plan — Sprints por proyecto y reporte de fin de sprint

- **ID:** 018-sprints-and-reporting
- **Spec reference:** `./spec.md`
- **Estado:** ready
- **Depende de:** `015-project-membership-and-tickets`, `017-workspaces-and-boards`

---

## 1. Resumen técnico

Una tabla nueva (`sprints`), dos columnas a `tickets` (`sprint_id`, `estimated_hours`), una columna a `projects` (`next_sprint_number`), tres triggers (numeración correlativa, guard de sprint activo único, extensión del guard de contributor-scope), y tres nuevas rutas de API (`POST /api/sprints`, `PATCH /api/sprints/:id`, `POST /api/sprints/:id/close`). En UI: dos tabs nuevos en el workspace (Sprint, Old Sprints), rename del actual "Tablero" a "Tablero completo", y una vista de reporte de sprint cerrado.

Sin cron, sin envío externo, sin dependencias npm nuevas. Todo el modelo se apoya en lo que 015 y 017 ya tienen.

### Decisiones cerradas (del cuestionario)

- Sprints **por proyecto**, no cross-project.
- Estimación en **horas** (numeric, nullable, opcional).
- Nueva pestaña **"Sprint"** con drag desde backlog (o Select por ticket).
- **Cierre manual solo del PM primario**; admin puede todo lo demás.
- **Rollover automático** al siguiente `planned`; sin `planned` bloquea el cierre.
- **Sin auto-cierre por fecha** (cron descartado).
- Tab "Old Sprints" solo muestra los cerrados.
- Contributor no puede cambiar `sprint_id` (extensión del trigger de contributor-scope).

---

## 2. Modelo de datos

### 2.1 Tabla `sprints`

```sql
create type public.sprint_status as enum ('planned', 'active', 'completed');

create table public.sprints (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete restrict,
  numero         int  not null,
  name           text,
  goal           text,
  starts_at      date not null,
  ends_at        date not null,
  status         public.sprint_status not null default 'planned',
  closed_at      timestamptz,
  report         jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint sprints_dates_ok check (ends_at >= starts_at),
  constraint sprints_completed_has_closed_at
    check (
      (status = 'completed' and closed_at is not null and report is not null)
      or (status <> 'completed' and closed_at is null and report is null)
    ),
  constraint sprints_numero_unique_per_project unique (project_id, numero)
);

-- Índice parcial que garantiza un solo activo por proyecto — es el enforcement
-- duro; la UI colabora escondiendo el botón "Activar" cuando ya hay otro, pero
-- una race condition entre dos PMs cliqueando simultáneamente cae acá.
create unique index sprints_one_active_per_project
  on public.sprints (project_id)
  where status = 'active';

create index sprints_project_status_idx on public.sprints (project_id, status);
```

`on delete restrict` en `project_id`: la convención del proyecto (D-6 de 015) es que borrar proyectos no está soportado — se desactivan. Un sprint es historia dura del proyecto; restrict lo hace explícito.

### 2.2 Extensiones a `tickets`

```sql
alter table public.tickets
  add column sprint_id       uuid references public.sprints(id) on delete set null,
  add column estimated_hours numeric(5, 2) check (estimated_hours is null or estimated_hours >= 0);

create index tickets_sprint_idx on public.tickets (sprint_id) where sprint_id is not null;
```

`on delete set null` en el FK — un sprint no se borra en la práctica, pero si algún día se hiciera, los tickets vuelven al backlog en vez de romperse. Consistente con el trato "blando" de FKs históricas.

### 2.3 Extensión a `projects`

```sql
alter table public.projects
  add column next_sprint_number int not null default 1;
```

Análogo a `next_ticket_number` de 015. El trigger de alta de sprint lo consume.

---

## 3. Triggers

### 3.1 `assign_sprint_number` (before insert)

Copia del patrón de `assign_ticket_number` de 015. Lockea la fila de `projects` con `update ... returning`, asigna `numero`, incrementa el contador. `when (new.numero is null)` para no pisar seeds.

### 3.2 `enforce_sprint_status_transitions` (before update of status)

Valida:
- `planned → active`: OK. La unique parcial garantiza el "solo uno" adicional.
- `active → completed`: OK **solo si `closed_at is not null and report is not null`**. Sin esos dos, tira `check_violation` — es la garantía que impide cerrar sin snapshot.
- Cualquier otra transición: prohibida. Nadie vuelve de `completed`.

### 3.3 Extensión de `enforce_ticket_contributor_scope` (015 T1.12)

El trigger actual permite a `contributor` cambiar `status` de cualquier ticket y `title`/`description`/`priority`/`assignee_id` **si es propio**. Se extiende para tratar `sprint_id` y `estimated_hours` como **campos no permitidos a contributor** — solo admin/PM/lead pueden tocarlos.

La whitelist implícita del guard actual es `to_jsonb(new) - {'status','updated_at'} = to_jsonb(old) - ...`. Con la migration 15 (hotfix), el diff genérico ya funciona bien. **La extensión es:** agregar dos checks explícitos antes de la evaluación del contributor-edit, para que rechacen incluso si el ticket es propio:

```sql
-- Antes del "3) Edit completo: solo si es propio" del actor contributor:
if new.sprint_id is distinct from old.sprint_id then
  raise exception 'Solo lead+ puede reasignar sprints'
    using errcode = '23514',
          hint    = 'Cambiar el sprint de un ticket es planning — pedile a un lead o al PM.';
end if;

if new.estimated_hours is distinct from old.estimated_hours then
  raise exception 'Solo lead+ puede estimar horas'
    using errcode = '23514',
          hint    = 'La estimación es responsabilidad de la planificación del sprint.';
end if;
```

---

## 4. RLS y grants

### 4.1 Grants

```sql
grant select, insert, update on public.sprints to authenticated;
-- Nada de delete: el cierre es el equivalente terminal.
```

### 4.2 Policies

```sql
-- select: cualquier miembro del proyecto ve los sprints.
create policy "sprints: read for project members"
  on public.sprints for select to authenticated
  using (public.can_view_project(project_id));

-- insert: admin o PM del proyecto.
create policy "sprints: admin/PM insert"
  on public.sprints for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    or public.is_pm_of_project(project_id)
  );

-- update: admin o PM del proyecto. La granularidad (quién puede cerrar) la
-- hace la API — la RLS no distingue "cerrar" de "editar objetivo".
create policy "sprints: admin/PM update"
  on public.sprints for update to authenticated
  using (
    public.is_admin(auth.uid())
    or public.is_pm_of_project(project_id)
  )
  with check (
    public.is_admin(auth.uid())
    or public.is_pm_of_project(project_id)
  );
```

**Nota importante sobre el cierre:** el guard "solo PM primario, NO admin" para cerrar NO vive en la RLS — la policy de update deja pasar a admin. Vive en el handler `POST /api/sprints/:id/close`, que chequea `profile.id === project.pm_id` y rechaza a admin con 403. Rationale: la RLS es una regla estructural (quién puede tocar la tabla); "quién puede firmar el reporte" es una regla de producto que naturalmente vive en el handler.

---

## 5. API

### 5.1 `POST /api/sprints`

```
Body:
  { project_id, starts_at, ends_at, name?, goal? }

Guard: requireProjectMembership(project_id, 'pm')
Trigger: assign_sprint_number asigna `numero`.
Response: 201 { ...sprint, displayName: name ?? `Sprint ${numero}` }
```

### 5.2 `PATCH /api/sprints/:id`

Acepta:
- `name`, `goal`, `starts_at`, `ends_at`: cualquiera admin/PM.
- `status`: **solo transición a `active`** desde `planned`. La transición a `completed` NO se acepta acá — va por el endpoint de cierre dedicado, que hace el rollover.

```
Body:
  { name?, goal?, starts_at?, ends_at?, status?: 'active' }

Guard: requireProjectMembership(sprint.project_id, 'pm')
Traducción: 23505 sobre `sprints_one_active_per_project` → 409 con motivo
            ("ya hay otro sprint activo en el proyecto").
```

### 5.3 `POST /api/sprints/:id/close`

El endpoint del cierre — lo que hace todo el trabajo pesado.

```
Guard:
  1. requireProjectMembership(project_id, 'pm')
  2. profile.id === project.pm_id (rechaza admin — AC-5.4)
  3. sprint.status === 'active'

Body opcional:
  { confirmed: boolean }  // segundo llamado, luego de mostrar el diálogo.

Flujo:
  a. Contar tickets no completados del sprint.
  b. Si count > 0 y NO hay sprint `planned` en el proyecto:
     → 409 con { reason: 'needs_next_sprint' }.
     El cliente muestra el diálogo "Creá el próximo sprint antes de cerrar".
  c. Si count > 0 y hay `planned`:
     → RPC transaccional `close_sprint_with_rollover(sprint_id, next_sprint_id)`
        que en una sola transacción:
        - UPDATE tickets SET sprint_id = <next> WHERE sprint_id = <this>
          AND status NOT IN ('done', 'cancelled')
        - Genera el snapshot con datos DEL MOMENTO ANTES del update.
        - UPDATE sprints SET status='completed', closed_at=now(), report=<snapshot>
     Rationale del RPC (security definer): garantiza atomicidad — el rollover y
     el cierre no pueden quedar a medias. La RLS `sprints: admin/PM update`
     bastaría para el UPDATE en solitario, pero el orden importa (snapshot ANTES
     del update de tickets) y una transacción explícita lo garantiza.
  d. Si count === 0: mismo RPC con next_sprint_id = null.

Response: 200 { sprint: <updated>, rolledOverTicketCount: N }
```

El snapshot que se guarda en `report jsonb`:

```json
{
  "closed_at": "2026-...",
  "starts_at": "2026-...",
  "ends_at": "2026-...",
  "tickets": {
    "total_at_close": 12,
    "completed": 9,
    "rolled_over": 3
  },
  "hours": {
    "estimated_total": 60,
    "estimated_completed": 42,
    "unestimated_count": 1
  },
  "by_assignee": [
    { "user_id": "...", "name": "...", "tickets_completed": 4, "hours_completed": 20 },
    ...
  ],
  "rolled_over_to_sprint_id": "uuid-of-next-sprint" | null
}
```

### 5.4 Extensión a `PATCH /api/tickets/:id`

El schema `updateTicketSchema` de 015 gana:
- `sprint_id?: uuid | null` (mover a otro sprint o al backlog)
- `estimated_hours?: number | null` (>= 0)

El handler valida:
- Si `sprint_id !== null`: el sprint pertenece al mismo proyecto que el ticket **y** su status no es `completed` (AC-3.4).
- El trigger de contributor-scope rechaza al contributor que intente tocar cualquiera de los dos campos.

---

## 6. UI — cambios en el workspace

### 6.1 Tabs

Actual (después de 017 + P8 de 015):
```
Tablero | Backlog | Miembros
```

Después de 018:
```
Sprint (default) | Backlog | Tablero completo | Old Sprints | Miembros
```

`redirect(/board)` de `[projectKey]/page.tsx` pasa a `redirect(/sprint)` — el default del workspace es la vista del sprint activo. "Tablero completo" es el mismo kanban de hoy sin filtro.

### 6.2 Tab "Sprint" — `/projects/[key]/sprint`

Server component. Query en cascada:
1. `getProjectByKey(key)` (cacheado por request).
2. `getActiveSprint(projectId)` — devuelve el sprint activo o null.
3. `getPlannedSprints(projectId)` — lista de planificados.
4. Si hay activo: `getTicketsList({ projectId, sprintId: active.id, statuses: [...all six] }, viewerId)`.

Componentes cliente:
- `<SprintHeader sprint={active} tickets={sprintTickets} />` — nombre, fechas, objetivo, progreso de horas (bar horizontal), warning si hay tickets sin estimar, botón "Cerrar sprint" (visible solo si soy PM primario), y menú "..." con "Editar" (dialog).
- `<KanbanBoard>` — el mismo que hoy, filtrado a los tickets del sprint.
- `<PlannedSprintsList sprints={planned} canManage={admin||pm} />` — al pie. Cada card: nombre, fechas, count de tickets, botón "Activar" (habilitado solo si no hay activo).
- Si no hay activo ni planificado: `<EmptyState title="Sin sprints" description="..." action={<CreateSprintButton />} />`.

`<CreateSprintButton>` es un dialog análogo a `<CreateTicketButton>` de 015: fechas obligatorias, nombre y objetivo opcionales.

### 6.3 Tab "Backlog" — modificaciones

Extiende `<TicketList>` con una columna nueva **"Sprint"** que muestra:
- "Backlog" (`text-muted-foreground`) si `sprint_id === null`.
- El nombre del sprint (`text-secondary-foreground`) si tiene.

Cliente ganan un `<Select>` inline (visible solo para admin/PM/lead) con las opciones "Backlog" + sprints no-cerrados del proyecto. El `PATCH` va al mismo `/api/tickets/:id` que 015.

**Estimación inline:** una columna extra "Est. hs" con un input numérico compacto (solo lectura para contributor, editable para lead+).

### 6.4 Tab "Old Sprints" — `/projects/[key]/sprints`

Lista simple: tabla con Número/Nombre, Fechas, Cerrado el, Tickets (X/Y), Horas est. (X/Y hs), acción "Ver reporte". Fila clickeable → `/projects/[key]/sprints/[N]`.

### 6.5 Vista de reporte — `/projects/[key]/sprints/[N]`

Server component. Fetch del sprint por `numero` + `project.id`, si `status !== 'completed'` → 404 (los planificados/activos no tienen vista de reporte). Renderiza:
- Header con nombre / fechas / cerrado el.
- Grid con las métricas del snapshot (tickets completados vs totales, horas est.).
- Tabla de "Por asignado".
- Lista de tickets que estuvieron en el sprint, cada uno con su status **al momento del cierre** (leído del snapshot, no del ticket actual — R-2).
- Nota al pie: "Reporte congelado el DD/MM/YYYY HH:MM. Cambios posteriores en los tickets no se reflejan acá."

---

## 7. Sync indicator y errores

Reuso del `useSyncIndicator()` de 017 para todas las operaciones asíncronas del panel — "Guardando sprint", "Activando", "Cerrando sprint". El cierre puede tomar segundos (rollover de N tickets + snapshot); el pill flotante evita que el PM lo re-clickee.

Los 409 se muestran inline en el header del sprint (no toast) con el motivo del server ("ya hay otro sprint activo"; "hay tickets sin cerrar y no hay próximo sprint"). Los 403 (contributor tocando `sprint_id`) los rechaza el trigger — improbables en UI porque los controles se esconden, pero el handler los devuelve con `reason` del hint.

---

## 8. Migrations

Todo en **una sola migration** (`00000000000016_sprints.sql`) porque es cambio nuevo, no destructivo:

1. Enum `sprint_status`.
2. Tabla `sprints` con constraints e índices.
3. `alter table tickets` — agregar `sprint_id` y `estimated_hours`.
4. `alter table projects` — agregar `next_sprint_number`.
5. Trigger `assign_sprint_number`.
6. Trigger `enforce_sprint_status_transitions`.
7. Update de la función `enforce_ticket_contributor_scope` sumando los dos checks nuevos.
8. Función `close_sprint_with_rollover(sprint_id, next_sprint_id)` — security definer.
9. Policies y grants.

Two-phase safe: cero remoción de columnas, cero cambio de tipos. El deploy previo sigue funcionando sin conocer las columnas nuevas (los queries de 017 no filtran por `sprint_id`, solo lo ignoran). Después del deploy que consume, no hay tercer paso — nada que borrar.

---

## 9. Testing (aspiracional)

- **Unit:** parseo de fechas del form de creación, generación del snapshot del reporte a partir de una lista de tickets simulada.
- **Integración (Phase 9-style):** unique partial del active-per-project, trigger de numeración correlativo con 20 inserts paralelos, rollover automático con y sin sprint planificado siguiente, extensión del contributor-scope rechazando cambios a `sprint_id`.
- **Smoke (PostgREST):** embed `sprints ← tickets` para el count del reporte, filtro por `sprint_id is null` para el backlog.
- **E2E:** happy path — PM crea sprint, lo activa, mueve tickets, cierra con rollover, ve el reporte en Old Sprints.

Como con 015 y 017, la Phase de tests queda **abierta** hasta que el equipo decida priorizarla. La documentación de la Phase queda escrita en `tasks.md` para no perder el mapa.

---

## 10. Riesgos revisitados (los de spec + los técnicos)

- **R-1 (spec)** — unique partial del active resuelve concurrencia dura; UI esconde el botón.
- **R-2 (spec)** — snapshot inmutable es feature, no bug; UI lo comunica.
- **R-3 (spec)** — tickets rolleados a sprint futuro con arranque tardío se ven en el tab "Sprint" bajo "Próximos"; comportamiento correcto.
- **R-4 (spec)** — trigger rechaza contributor si vuelve por API; UI le esconde controles.
- **R-6 (spec)** — dos tabs con kanban (Sprint + Tablero completo) se distingue por default y por label.
- **R-7 (plan) — Trigger de contributor-scope tocado por 018.** El trigger es central; una migration mal escrita puede romper edits legítimos. **Mitigación:** dos checks agregados adelante del path de contributor-edit, sin tocar el path de admin/PM/lead. Los tests de 015 F6 (cuando existan) deben cubrir también el rechazo de `sprint_id`.
- **R-8 (plan) — `close_sprint_with_rollover` como `security definer` sin filtro de proyecto adentro.** La función necesita hacer el UPDATE de tickets del sprint independientemente de RLS (el trigger de contributor-scope no se dispara con `security definer` sin `auth.uid()`, pero el chequeo del handler que llama al RPC ya garantizó que es el PM). **Mitigación:** la función solo acepta `sprint_id` cuyo proyecto matchee el `auth.uid()` del contexto — se pasa como parámetro y se valida adentro.

---

## 11. Cierre

Al terminar:

1. Marcar 018 como done en `specs/features/README.md`.
2. Actualizar `CLAUDE.md`:
   - Sección estructura: nuevas rutas de sprint.
   - Sección "Estado de features".
   - Nota de que el trigger `enforce_ticket_contributor_scope` fue extendido en migration 16.
3. `DESIGN.md` §14 puede sumar una entrada breve si el `<SprintHeader>` introduce algún patrón visual reusable (por ej. la barra de progreso de horas), pero no anticipa nada nuevo — probablemente no hace falta.
4. Verificación visual del usuario en el browser.
