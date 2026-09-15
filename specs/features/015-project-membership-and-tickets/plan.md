# Plan — Membresía por proyecto y tickets

- **ID:** 015-project-membership-and-tickets
- **Spec de referencia:** `./spec.md`
- **Estado:** ready
- **Depende de:** `001-auth-and-permissions`, `002-entities-admin`, `010-notifications-and-audit`, `012-multiple-roles-and-active-enforcement`

---

## 1. Resumen técnico

Cuatro cosas nuevas y una extensión: (a) tablas `project_members` y `tickets` con enums propios, (b) dos columnas nuevas en `projects` (`key`, `next_ticket_number`) para la clave estable `PROJ-N`, (c) cinco triggers (numeración correlativa, auto-add del PM como `lead`, inmutabilidad de `key` con tickets, notificaciones, audit), (d) dos endpoints Next.js para escrituras (`POST /api/tickets`, `PATCH /api/tickets/:id`) más un tercer par para membresías (`POST/PATCH /api/project-members`), y (e) tres vistas nuevas (`/tickets`, `/tickets/:key`, y una sub-sección "Miembros" adentro de `/admin/projects/:id`).

Todo se apoya sobre lo que ya existe: `profiles` con `roles[]` (`012`), `is_admin()`/`has_role()`, `audit_log` (`010`), la infra de `notifications` con `notify_user()` (`010`, ADR 0012), el patrón de state-in-URL de `/calendar` (`003`), y los guards de handlers (`readJsonBody`, `requireAdmin`, `getCurrentUser`).

### Decisiones cerradas (del cuestionario y de las D-1..D-8)

- **D-1 · Notificaciones en `015`**: sí, dos eventos — `ticket_assigned` y `ticket_status_changed`. Trigger análogo al de bookings (ADR 0012); in-app + email; copy en `src/lib/notifications/events.ts`.
- **D-2 · Path de UI**: `/tickets` global con filtros en URL (patrón de `/calendar`). Detalle en `/tickets/:key`. Sin sub-tab en `/projects/:key` por ahora.
- **D-3 · Formato de `description`**: **markdown con preview**. Editor y viewer propios sobre `react-markdown` + `rehype-sanitize` + `remark-gfm`. Sin syntax highlight, sin imágenes en MVP.
- **D-4 · Alcance del `contributor`**: edita **tickets propios** (`created_by = auth.uid()` OR `assignee_id = auth.uid()`); **transiciona `status` de cualquiera** del proyecto (colaborativo); **no reasigna** (`assignee_id` es `lead`+). Esto se enforcea con un trigger `before update`, no con la policy (ADR 0009 — RLS no distingue columnas).
- **D-5 · `tickets.estimacion_horas`**: fuera de `015`. `016-time-tracking` la agrega en su primera migration.
- **D-6 · PM saliente cuando cambia `projects.pm_id`**: se **baja a `contributor`** (pierde `lead`, no pierde membresía). Rationale: es la reasignación real, el PM saliente pierde poder de administración pero puede seguir viendo el proyecto para cerrar cabos. El trigger de auto-add promueve al entrante y demora al saliente en la misma transacción.
- **D-7 · Hard delete de tickets**: no. Cancel-only (`status = 'cancelled'`), coherente con el patrón del resto (bookings, clients, projects, users — nada se borra físicamente en el producto). El `DELETE` sobre `tickets` no está grant-eado a `authenticated`.
- **D-8 · `projects.pm_id` como `lead` implícito**: sí en RLS (`can_view_project` incluye `pm_id = auth.uid()`) **y** fila real en `project_members` poblada por el trigger. Redundante en la práctica —quien es PM del proyecto siempre tendrá fila `lead`—, pero explícito: el UI de miembros lo muestra, y si alguien manualmente borra la fila, la policy sigue funcionando.

---

## 2. Arquitectura

```
supabase/migrations/
  YYYYMMDDHHMMSS_015_project_membership_and_tickets.sql

src/lib/
  auth/
    roles.ts                           (sin cambios — 'staff' no entra en 015)
  tickets/
    keys.ts                            → parseTicketKey('WDW-42'), formatTicketKey({ key, numero })
    permissions.ts                     → canEditTicket(profile, ticket, project)
    status.ts                          → TICKET_STATUS_ORDER, TICKET_STATUS_LABELS, TICKET_PRIORITY_LABELS
    query.ts                           → getTicketByKey(), getTicketsList({ filters })
    url.ts                             → parseTicketFilters(searchParams), buildTicketsHref(...)
  validation/
    tickets.ts                         → createTicketSchema, updateTicketSchema, project_member schemas
  api/
    require-project-membership.ts      → requireProjectMembership(projectId, minRole)
    require-ticket-access.ts           → requireTicketAccess(ticketId)
  notifications/
    events.ts                          agrega ticket_assigned + ticket_status_changed
  markdown/
    editor.tsx                         → <MarkdownEditor value onChange />  (client)
    viewer.tsx                         → <MarkdownViewer content />         (server-safe)
    sanitize.ts                        → schema de rehype-sanitize acotado

src/app/(app)/
  tickets/
    page.tsx                           listado global con filtros
    loading.tsx
    error.tsx
    [key]/
      page.tsx                         detalle
      loading.tsx
  admin/projects/
    [id]/
      members.tsx                      sub-sección "Miembros" del proyecto (nueva)
      page.tsx                         (ajuste: incluir <Members /> abajo del form)

src/app/api/
  tickets/
    route.ts                           POST
    [id]/route.ts                      PATCH
  project-members/
    route.ts                           POST
    [id]/route.ts                      PATCH

src/components/
  tickets/
    ticket-list.tsx                    client, tabla + filtros
    ticket-list-filters.tsx            client, sincroniza URL
    ticket-row.tsx
    ticket-detail.tsx
    ticket-form-dialog.tsx             alta y edición
    ticket-status-badge.tsx
    ticket-priority-badge.tsx
    ticket-assignee-select.tsx         solo miembros activos del proyecto
    project-members-panel.tsx          server component + client rows
```

---

## 3. Modelo de datos

### 3.1 Enums

```sql
create type project_member_role as enum ('viewer', 'contributor', 'lead');
create type ticket_status      as enum ('todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled');
create type ticket_priority    as enum ('low', 'medium', 'high', 'critical');
```

Orden en `project_member_role` importa para comparación por orden (`>= 'contributor'`), pero no lo usamos: preferimos comparaciones por igualdad explícita para no depender del orden del enum. Documento igual el orden por convención.

### 3.2 Extensiones a `projects`

```sql
alter table projects
  add column key varchar(8),
  add column next_ticket_number int not null default 1;
```

**Backfill de `key`** para filas existentes (Q-7):

```sql
-- Toma las primeras 2-6 letras de `nombre`, en mayúscula, quitando lo no-alfabético.
-- Fallback 'PROJ' si el nombre no tiene letras (imposible en la data actual, pero defensivo).
update projects
set key = coalesce(
  nullif(upper(substring(regexp_replace(nombre, '[^A-Za-z]', '', 'g') from 1 for 6)), ''),
  'PROJ'
)
where key is null;
```

**Después del backfill**, se enforcean invariantes:

```sql
alter table projects
  alter column key set not null,
  add constraint projects_key_format check (key ~ '^[A-Z][A-Z0-9]{1,7}$'),
  add constraint projects_key_unique unique (key);
```

Colisión de `key` post-backfill (dos proyectos "White Label Argentina" y "White Label Arg") es rara pero posible; la migration falla ruidosamente en `unique`, no en silencio. La resolución es que el admin renombre uno antes de re-correr la migration en CI (regla de "que no rompa" del CLAUDE.md).

### 3.3 `project_members`

```sql
create table project_members (
  id                uuid                primary key default gen_random_uuid(),
  project_id        uuid                not null references projects(id) on delete cascade,
  user_id           uuid                not null references profiles(id) on delete restrict,
  role_in_project   project_member_role not null default 'contributor',
  active            boolean             not null default true,
  created_at        timestamptz         not null default now(),
  updated_at        timestamptz         not null default now(),
  unique (project_id, user_id)
);

create index project_members_user_active_idx
  on project_members(user_id) where active = true;
create index project_members_project_active_idx
  on project_members(project_id) where active = true;
```

**Sobre los `on delete`** (convención del CLAUDE.md, sección "Migrations"):

- `project_id → projects(id) on delete cascade`: los proyectos **no se borran** en la app (se desactivan), pero si un admin lo borra con `service_role`, cascadear miembros es correcto — no son historia. La historia queda en `audit_log`.
- `user_id → profiles(id) on delete restrict`: los profiles tampoco se borran (se desactivan). Si alguien intenta borrar un profile con `service_role` y tiene membresías, la operación falla — se lo obliga a desactivar. Es dura a propósito.

### 3.4 `tickets`

```sql
create table tickets (
  id           uuid              primary key default gen_random_uuid(),
  project_id   uuid              not null references projects(id) on delete restrict,
  numero       int               not null,
  title        text              not null check (length(title) between 1 and 200),
  description  text,             -- markdown crudo; se sanitiza en render
  status       ticket_status     not null default 'todo',
  priority     ticket_priority   not null default 'medium',
  assignee_id  uuid              references profiles(id) on delete set null,
  created_by   uuid              not null references profiles(id) on delete restrict,
  created_at   timestamptz       not null default now(),
  updated_at   timestamptz       not null default now(),
  unique (project_id, numero)
);

create index tickets_project_status_updated_idx
  on tickets(project_id, status, updated_at desc);
create index tickets_assignee_idx
  on tickets(assignee_id) where assignee_id is not null;
create index tickets_created_by_idx
  on tickets(created_by);
```

**Sobre los índices**: el listado global de `/tickets` es la query dominante — filtro por `status`/`assignee_id`/`projectId` y orden por `updated_at desc`. El compuesto `(project_id, status, updated_at desc)` cubre el caso "tickets abiertos del proyecto X ordenados por lo último". `assignee_id` parcial cubre el filtro `assigneeId = me`. `created_by` es para la regla de contributor edita-lo-suyo (trigger de §5.4). Con 6 personas y proyectos chicos, los índices son baratos de mantener; los agregamos igual porque el CLAUDE.md desalienta agregarlos "por escala" pero **no** por corrección de la RLS —los helpers son `stable` y consultan estas tablas—.

### 3.5 Registro de tipos nuevos en `audit_log`

`audit_log` ya existe. Se agrega `entity_type = 'ticket'` a los valores esperados. Como es texto libre, no hay migration de schema — solo documentación. Los payloads:

- `ticket_created` — `payload = { title, priority, assignee_id, project_id }`.
- `ticket_status_changed` — `payload = { from, to }`.
- `ticket_updated` — `payload = diff of fields changed` (no incluye `description` en el diff porque puede ser larga; solo `description_changed: true`).
- `ticket_assignee_changed` — `payload = { from, to }`.

---

## 4. RLS, grants y helpers

### 4.1 Grants

```sql
grant select, insert, update on project_members to authenticated;
grant select, insert, update on tickets to authenticated;

-- No delete a authenticated en ninguna de las dos. service_role tiene todo por default.
```

Sin grant explícito, la policy deniega en silencio (ver CLAUDE.md, "Migrations").

### 4.2 Helpers

```sql
create or replace function public.is_project_member(
  p_project_id uuid,
  p_user_id    uuid default auth.uid()
) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from project_members pm
    join profiles pr on pr.id = pm.user_id
    where pm.project_id = p_project_id
      and pm.user_id    = p_user_id
      and pm.active     = true
      and pr.active     = true
  );
$$;

create or replace function public.role_in_project(
  p_project_id uuid,
  p_user_id    uuid default auth.uid()
) returns project_member_role
  language sql
  stable
  security definer
  set search_path = public
as $$
  select pm.role_in_project
  from project_members pm
  join profiles pr on pr.id = pm.user_id
  where pm.project_id = p_project_id
    and pm.user_id    = p_user_id
    and pm.active     = true
    and pr.active     = true;
$$;

create or replace function public.is_pm_of_project(
  p_project_id uuid,
  p_user_id    uuid default auth.uid()
) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from projects p
    join profiles pr on pr.id = p_user_id
    where p.id = p_project_id
      and p.pm_id = p_user_id
      and pr.active = true
  );
$$;

create or replace function public.can_view_project(
  p_project_id uuid,
  p_user_id    uuid default auth.uid()
) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select
    public.is_admin(p_user_id)
    or public.is_pm_of_project(p_project_id, p_user_id)
    or public.is_project_member(p_project_id, p_user_id);
$$;
```

**Regla de D-01 aplicada**: cada helper incluye `active = true` **adentro**, para que ninguna policy la olvide. Es exactamente lo que `has_role()` hace con roles (CLAUDE.md, sección "Roles y `active`").

### 4.3 Policies de `project_members`

```sql
alter table project_members enable row level security;

create policy "project_members: read for visible projects"
  on project_members for select to authenticated
  using ( public.can_view_project(project_id) );

create policy "project_members: admin/PM insert"
  on project_members for insert to authenticated
  with check (
    public.is_admin() or public.is_pm_of_project(project_id)
  );

create policy "project_members: admin/PM update"
  on project_members for update to authenticated
  using ( public.is_admin() or public.is_pm_of_project(project_id) )
  with check ( public.is_admin() or public.is_pm_of_project(project_id) );
```

- **Lectura**: cualquiera que pueda ver el proyecto ve su lista de miembros. Un lead **no** administra miembros — solo admin y PM. Es simple y suficiente al equipo actual.
- **No delete**: la baja es `active = false`.

### 4.4 Policies de `tickets`

```sql
alter table tickets enable row level security;

create policy "tickets: read for project members"
  on tickets for select to authenticated
  using ( public.can_view_project(project_id) );

create policy "tickets: contributor+ insert"
  on tickets for insert to authenticated
  with check (
    (
      public.is_admin()
      or public.is_pm_of_project(project_id)
      or public.role_in_project(project_id) in ('contributor', 'lead')
    )
    and exists (
      select 1 from projects p
      where p.id = tickets.project_id and p.estado != 'inactivo'
    )
  );

create policy "tickets: contributor+ update"
  on tickets for update to authenticated
  using (
    public.is_admin()
    or public.is_pm_of_project(project_id)
    or public.role_in_project(project_id) in ('contributor', 'lead')
  )
  with check (
    public.is_admin()
    or public.is_pm_of_project(project_id)
    or public.role_in_project(project_id) in ('contributor', 'lead')
  );
```

- **La granularidad fina del `contributor`** (edita propios, transiciona cualquiera, no reasigna) no cabe en RLS: es column-level. Se enforcea en el trigger `enforce_ticket_contributor_scope` (§5.4). La policy es amplia por eso — es el mismo patrón que `bookings: developer responds` documenta el CLAUDE.md.
- **Proyecto inactivo bloquea alta pero permite edit** (AC-2.5 del spec): el `estado != 'inactivo'` está en el `with check` del insert, no en el del update. Mismo patrón que bookings (D-08).

---

## 5. Triggers

### 5.1 Numeración correlativa (`assign_ticket_number`)

```sql
create or replace function public.assign_ticket_number()
returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  next_num int;
begin
  update projects
     set next_ticket_number = next_ticket_number + 1
   where id = new.project_id
   returning next_ticket_number - 1 into next_num;

  if next_num is null then
    raise exception 'Project % not found while assigning ticket number', new.project_id
      using errcode = 'foreign_key_violation';
  end if;

  new.numero := next_num;
  return new;
end;
$$;

create trigger tickets_assign_number
  before insert on tickets
  for each row
  when (new.numero is null)  -- deja pasar seeds/fixtures que lo setean explícito
  execute procedure public.assign_ticket_number();
```

**Por qué esto serializa correctamente**: `update projects ... where id = X` toma un lock de fila sobre `projects[X]`. Dos inserts concurrentes de tickets al mismo `project_id` se serializan sobre esa fila: el segundo espera, ve `next_ticket_number` ya incrementado, y toma el siguiente. Es exactamente el patrón que Postgres soporta bien, sin `SELECT ... FOR UPDATE` explícito.

**Test crítico** (§10): 20 inserts en paralelo al mismo proyecto → verificar que los `numero` son `{1..20}` sin repeticiones ni gaps.

### 5.2 Auto-add del PM primario (`autoadd_pm_as_lead`)

```sql
create or replace function public.autoadd_pm_as_lead()
returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- Al insertar el proyecto o cambiar de PM: promover al entrante a lead
  if new.pm_id is not null then
    insert into project_members (project_id, user_id, role_in_project, active)
    values (new.id, new.pm_id, 'lead', true)
    on conflict (project_id, user_id) do update
      set role_in_project = 'lead',
          active          = true,
          updated_at      = now();
  end if;

  -- Solo en UPDATE con cambio real de pm_id: degradar al saliente (D-6)
  if tg_op = 'UPDATE'
     and old.pm_id is not null
     and old.pm_id is distinct from new.pm_id then
    update project_members
       set role_in_project = 'contributor',
           updated_at      = now()
     where project_id      = new.id
       and user_id         = old.pm_id
       and role_in_project = 'lead';
  end if;

  return new;
end;
$$;

create trigger projects_autoadd_pm_as_lead
  after insert or update of pm_id on projects
  for each row execute procedure public.autoadd_pm_as_lead();
```

**Backfill** de miembros para proyectos ya existentes:

```sql
insert into project_members (project_id, user_id, role_in_project, active)
select id, pm_id, 'lead', true
from projects
where pm_id is not null
on conflict (project_id, user_id) do nothing;
```

### 5.3 Inmutabilidad de `projects.key` (`enforce_project_key_immutable`)

```sql
create or replace function public.enforce_project_key_immutable()
returns trigger
  language plpgsql
as $$
begin
  if old.key is distinct from new.key
     and exists (select 1 from tickets where project_id = new.id limit 1) then
    raise exception 'Cannot change key of project % once it has tickets', new.id
      using errcode = 'check_violation',
            hint    = 'La clave del proyecto ya está en uso por tickets creados.';
  end if;
  return new;
end;
$$;

create trigger projects_enforce_key_immutable
  before update of key on projects
  for each row execute procedure public.enforce_project_key_immutable();
```

### 5.4 Guard de scope del contributor (`enforce_ticket_contributor_scope`)

Éste es el análogo al guard de bookings de ADR 0009. La policy es amplia; el guard achica.

```sql
create or replace function public.enforce_ticket_contributor_scope()
returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  actor_id       uuid := auth.uid();
  actor_project_role project_member_role;
  status_only_change boolean;
begin
  -- service_role, admin y PM del proyecto pasan sin chequeo
  if actor_id is null                                    -- service_role llega sin uid
     or public.is_admin(actor_id)
     or public.is_pm_of_project(old.project_id, actor_id) then
    return new;
  end if;

  actor_project_role := public.role_in_project(old.project_id, actor_id);

  -- lead pasa
  if actor_project_role = 'lead' then
    return new;
  end if;

  -- Viewer no debería llegar (RLS lo filtra), pero defensivo:
  if actor_project_role is null or actor_project_role = 'viewer' then
    raise exception 'No permission to update ticket'
      using errcode = 'check_violation';
  end if;

  -- contributor:
  -- 1) Reasignar es lead+ solamente.
  if new.assignee_id is distinct from old.assignee_id then
    raise exception 'Only lead can reassign tickets'
      using errcode = 'check_violation',
            hint    = 'Solo un lead o admin puede cambiar el asignado.';
  end if;

  -- 2) Cambio de status únicamente: siempre permitido (colaborativo).
  status_only_change :=
    to_jsonb(new) - array['status', 'updated_at']::text[]
    = to_jsonb(old) - array['status', 'updated_at']::text[];

  if status_only_change then
    return new;
  end if;

  -- 3) Edit completo: solo si es propio (creado o asignado a mí).
  if old.created_by = actor_id or old.assignee_id = actor_id then
    return new;
  end if;

  raise exception 'Contributor can only transition status or edit own tickets'
    using errcode = 'check_violation',
          hint    = 'Podés cambiar solo el estado de este ticket. Para editar otros campos, pedile a un lead.';
end;
$$;

create trigger tickets_enforce_contributor_scope
  before update on tickets
  for each row execute procedure public.enforce_ticket_contributor_scope();
```

**La whitelist es de lo que se puede cambiar mediante status-only, no de lo que está prohibido**: `to_jsonb(new) - {'status','updated_at'} = to_jsonb(old) - {'status','updated_at'}` compara todo excepto esas dos columnas. Cualquier columna nueva que agregue una feature futura (por ejemplo `estimacion_horas` en `016`) nace protegida: si un contributor manda ese campo en un `PATCH`, el guard rechaza. **Consecuencia práctica**: una migration en `016` que agregue una columna a `tickets` puede romper la respuesta del contributor si esa columna viaja junto con un cambio de status. Igual patrón que en `bookings`, y la nota va al `plan.md` de `016`.

### 5.5 Notificaciones (`notify_ticket_events`)

```sql
create or replace function public.notify_ticket_events()
returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null
       and new.assignee_id is distinct from actor_id then
      perform public.notify_user(
        new.assignee_id,
        'ticket_assigned',
        jsonb_build_object(
          'ticket_id',   new.id,
          'project_id',  new.project_id,
          'title',       new.title,
          'assigned_by', actor_id
        )
      );
    end if;
    return new;
  end if;

  -- UPDATE

  if new.assignee_id is distinct from old.assignee_id
     and new.assignee_id is not null
     and new.assignee_id is distinct from actor_id then
    perform public.notify_user(
      new.assignee_id,
      'ticket_assigned',
      jsonb_build_object(
        'ticket_id',           new.id,
        'project_id',          new.project_id,
        'title',                new.title,
        'assigned_by',         actor_id,
        'previous_assignee_id', old.assignee_id
      )
    );
  end if;

  if new.status is distinct from old.status then
    -- Notificamos al asignado (si no es el actor)
    if new.assignee_id is not null
       and new.assignee_id is distinct from actor_id then
      perform public.notify_user(
        new.assignee_id,
        'ticket_status_changed',
        jsonb_build_object(
          'ticket_id',   new.id,
          'project_id',  new.project_id,
          'title',       new.title,
          'from_status', old.status,
          'to_status',   new.status,
          'changed_by',  actor_id
        )
      );
    end if;

    -- Y al creador si no es actor y no es asignado (evita el doble)
    if new.created_by is distinct from actor_id
       and new.created_by is distinct from new.assignee_id then
      perform public.notify_user(
        new.created_by,
        'ticket_status_changed',
        jsonb_build_object(
          'ticket_id',   new.id,
          'project_id',  new.project_id,
          'title',       new.title,
          'from_status', old.status,
          'to_status',   new.status,
          'changed_by',  actor_id
        )
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger tickets_notify_events
  after insert or update of assignee_id, status on tickets
  for each row execute procedure public.notify_ticket_events();
```

`notify_user()` **ya** hace el check "no avisar de tu propia acción" (CLAUDE.md, "Notificaciones"), pero preferimos también chequear en el trigger para no ensuciar el log con no-ops. El texto lo arma `src/lib/notifications/events.ts` desde el `payload` (el copy se cambia sin migration, según ADR 0012).

### 5.6 Audit log (`audit_ticket_events`)

```sql
create or replace function public.audit_ticket_events()
returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  diff     jsonb;
begin
  if tg_op = 'INSERT' then
    insert into audit_log (actor_id, entity_type, entity_id, event, payload)
    values (
      actor_id, 'ticket', new.id, 'ticket_created',
      jsonb_build_object(
        'title',       new.title,
        'priority',    new.priority,
        'assignee_id', new.assignee_id,
        'project_id',  new.project_id
      )
    );
    return new;
  end if;

  -- UPDATE: escribimos filas específicas para status/assignee, y una genérica para el resto
  if new.status is distinct from old.status then
    insert into audit_log (actor_id, entity_type, entity_id, event, payload)
    values (
      actor_id, 'ticket', new.id, 'ticket_status_changed',
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into audit_log (actor_id, entity_type, entity_id, event, payload)
    values (
      actor_id, 'ticket', new.id, 'ticket_assignee_changed',
      jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id)
    );
  end if;

  -- Diff genérico para el resto de columnas (excluye status/assignee ya cubiertos, y updated_at)
  diff := (to_jsonb(new) - array['status','assignee_id','updated_at']::text[])
        - (to_jsonb(old) - array['status','assignee_id','updated_at']::text[]);
  if diff <> '{}'::jsonb then
    -- `description` puede ser larga: se marca "changed" pero no se guarda el contenido nuevo.
    if diff ? 'description' then
      diff := jsonb_set(diff, '{description}', to_jsonb('__changed__'::text));
    end if;
    insert into audit_log (actor_id, entity_type, entity_id, event, payload)
    values (actor_id, 'ticket', new.id, 'ticket_updated', diff);
  end if;

  return new;
end;
$$;

create trigger tickets_audit_events
  after insert or update on tickets
  for each row execute procedure public.audit_ticket_events();
```

`audit_log` para `project_members` sigue el mismo patrón (create / role_changed / deactivated) — se omite el SQL por brevedad, va idéntico en la migration.

---

## 6. Notificaciones — payload y copy

Se agregan dos tipos a `src/lib/notifications/events.ts`. Copy en español, tono directo, con link al ticket.

```ts
// src/lib/notifications/events.ts (adiciones)

export type TicketAssignedPayload = {
  ticket_id: string;
  project_id: string;
  title: string;
  assigned_by: string;
  previous_assignee_id?: string;
};

export type TicketStatusChangedPayload = {
  ticket_id: string;
  project_id: string;
  title: string;
  from_status: TicketStatus;
  to_status: TicketStatus;
  changed_by: string;
};

// Copy in-app + subject email
export const eventBuilders = {
  // ...existing
  ticket_assigned: {
    inApp: (p: TicketAssignedPayload, ctx) => ({
      title: `Te asignaron ${ctx.ticketKey}`,
      body: `${ctx.actorName} te asignó "${p.title}".`,
      link: `/tickets/${ctx.ticketKey}`,
    }),
    email: (p, ctx) => ({
      subject: `[DevsCalendar] Te asignaron ${ctx.ticketKey}: ${p.title}`,
      // ...
    }),
  },
  ticket_status_changed: {
    inApp: (p: TicketStatusChangedPayload, ctx) => ({
      title: `${ctx.ticketKey} → ${labelForStatus(p.to_status)}`,
      body: `${ctx.actorName} movió "${p.title}" de ${labelForStatus(p.from_status)} a ${labelForStatus(p.to_status)}.`,
      link: `/tickets/${ctx.ticketKey}`,
    }),
    email: {/* ... */},
  },
};
```

El builder recibe `ctx` con nombre del actor y `ticketKey` armados por el sender (el trigger solo guarda IDs). La resolución de `ticketKey` se hace en el sender consultando `projects.key` y `tickets.numero`.

**Como en el resto del proyecto**, el trigger guarda **hechos**, no oraciones — es lo que permite cambiar el copy sin migration ni afectar los avisos viejos (CLAUDE.md).

---

## 7. API surface

### 7.1 Handlers

| Método | Ruta | Body (Zod) | Response | Guard |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/api/tickets` | `createTicketSchema` | `201 { ticket }` con `key` | `requireProjectMembership(body.project_id, 'contributor')` |
| PATCH | `/api/tickets/:id` | `updateTicketSchema` | `200 { ticket }` | `requireTicketAccess(id)` — deriva del ticket |
| POST | `/api/project-members` | `createMemberSchema` | `201 { member }` | `requireProjectMembership(body.project_id, 'pm')` — admin o PM |
| PATCH | `/api/project-members/:id` | `updateMemberSchema` | `200 { member }` | derivado del proyecto del member |

**Lecturas**: no hay endpoint. Server Components hacen queries a Supabase directo, y la RLS filtra. Igual patrón que `/calendar`.

### 7.2 Schemas de Zod

```ts
// src/lib/validation/tickets.ts

export const ticketStatus = z.enum([
  'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled',
]);
export const ticketPriority = z.enum(['low', 'medium', 'high', 'critical']);

export const createTicketSchema = z.object({
  project_id:  z.string().uuid(),
  title:       z.string().trim().min(1).max(200),
  description: z.string().max(10_000).optional(),
  priority:    ticketPriority.default('medium'),
  assignee_id: z.string().uuid().nullable().optional(),
});

export const updateTicketSchema = z
  .object({
    title:       z.string().trim().min(1).max(200),
    description: z.string().max(10_000).nullable(),
    status:      ticketStatus,
    priority:    ticketPriority,
    assignee_id: z.string().uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty patch' });
```

`description` con límite 10 000 chars — evita descripciones patológicamente grandes que rompen el listado / audit log. Es alto pero acotado.

### 7.3 `requireProjectMembership`

```ts
// src/lib/api/require-project-membership.ts

export type MinRole = 'contributor' | 'lead' | 'pm' /* pm = admin OR pm_of_project */;

export async function requireProjectMembership(
  projectId: string,
  minRole: MinRole,
): Promise<{ profile: Profile; role: ProjectMemberRole | 'admin' | 'pm' }> {
  const supabase = await createServerClient();
  const profile = await getCurrentProfile();
  if (!profile) throw new UnauthorizedError();

  if (isAdmin(profile)) return { profile, role: 'admin' };

  const { data: project, error } = await supabase
    .from('projects')
    .select('pm_id, estado')
    .eq('id', projectId)
    .maybeSingle();

  if (error || !project) throw new NotFoundError();

  if (project.pm_id === profile.id) return { profile, role: 'pm' };

  const { data: member } = await supabase
    .from('project_members')
    .select('role_in_project, active')
    .eq('project_id', projectId)
    .eq('user_id', profile.id)
    .eq('active', true)
    .maybeSingle();

  if (!member) throw new ForbiddenError();

  const ok =
    minRole === 'contributor'
      ? member.role_in_project === 'contributor' || member.role_in_project === 'lead'
      : minRole === 'lead'
        ? member.role_in_project === 'lead'
        : false; // 'pm' — ya fue chequeado arriba

  if (!ok) throw new ForbiddenError();
  return { profile, role: member.role_in_project };
}
```

### 7.4 Traducción de errores del guard

- `NotFoundError` → `404`. **Nunca** `403` en la lectura por ID que no encuentra ticket/proyecto (AC-6.1 del spec: no revelar existencia).
- `ForbiddenError` → `403` con `{ error: 'forbidden', reason: '...' }`.
- Errores del trigger contributor-scope (`check_violation` con hint) → `403` con `reason` desde `hint`.
- `unique_violation` en `(project_id, numero)` → **imposible en la práctica** (el trigger asigna correlativo) pero si aparece, `500` (bug).
- Body inválido → `400` con detalle de Zod. Body vacío o mal formado → `400` (`readJsonBody()`).

---

## 8. UI

### 8.1 Markdown

Dos componentes propios, minimalistas, sobre tres libs (todas chicas y estables):

```
src/lib/markdown/
  editor.tsx     "use client" — textarea + preview tab
  viewer.tsx     server-safe — render sanitizado
  sanitize.ts    schema de rehype-sanitize acotado
```

Deps que se suman al `package.json`:

- `react-markdown` — renderer.
- `remark-gfm` — tablas, task lists, autolinks.
- `rehype-sanitize` — sanitizador con schema custom.

**Nodos permitidos** en el schema (whitelist explícita, todo lo demás se descarta):

- Párrafos, saltos de línea, headings h1–h4 (con `id` autogenerado por `rehype-slug` opcional; sin anclas por ahora).
- `strong`, `em`, `del`, `code` inline.
- Bloques de código (`pre > code`) sin resaltado de sintaxis.
- Listas `ul`/`ol`/`li` (con task list de gfm — `- [x]`).
- Blockquotes.
- Links (`a[href]`) — sanitizados a `http://`, `https://`, `mailto:`; forzados `target="_blank" rel="noopener noreferrer"`.
- Tablas de gfm.

**Excluido explícitamente**: imágenes, iframes, `html` crudo, atributos `style`/`class`/`on*`, cualquier scheme distinto a los tres arriba.

**Editor**: textarea sin toolbar. La UX es un tab "Escribir / Vista previa" (shadcn `Tabs` — igual patrón que la UI actual del calendario). Sin WYSIWYG. Los devs escriben markdown a mano; los no-devs (staff, PMs) tienen atajos visuales en un mini-toolbar de tres botones (`bold`, `italic`, `link`) que insertan la sintaxis en el textarea — no es un editor rico, es azúcar.

```tsx
<MarkdownEditor
  value={description ?? ''}
  onChange={setDescription}
  placeholder="Describí el ticket. Podés usar markdown."
  maxLength={10_000}
/>
```

**Viewer**: server-safe (no requiere `"use client"`).

```tsx
<MarkdownViewer content={ticket.description ?? ''} />
```

Con `content === ''`, renderiza un `<p className="text-muted-foreground italic">Sin descripción</p>`.

### 8.2 `/tickets` — listado global

Server Component. La query se arma con los filtros del URL (`src/lib/tickets/url.ts` — análogo a `src/lib/calendar/url.ts`). RLS filtra por membresía.

```
┌────────────────────────────────────────────────────────────────────┐
│  Tickets            [+ Nuevo ticket]                                │
├────────────────────────────────────────────────────────────────────┤
│ [Proyecto ▼] [Estado ▼] [Asignado ▼] [Prioridad ▼] [ 🔍 Buscar ]   │
│ □ Incluir cerrados                                                  │
├────────────────────────────────────────────────────────────────────┤
│ Key       │ Título                    │ Estado    │ Asig │ Actualiz │
│ WDW-42    │ Importar CSV de clientes  │ In progr  │ Emi  │ hace 2h  │
│ DEVCAL-8  │ Fix hidratación del cal   │ Todo      │ Cris │ hace 1d  │
│ ...                                                                 │
└────────────────────────────────────────────────────────────────────┘
```

- **Filtros**: implementados con `<Link>` que reconstruye el `href` (patrón del calendario). Ningún estado en React.
- **Default de status** (AC-3.3 del spec): filtra `status in ('todo','in_progress','in_review','blocked')`. Toggle "Incluir cerrados" agrega `('done','cancelled')` con `?includeClosed=1`.
- **Búsqueda `q`**: `ILIKE '%q%'` sobre `title`. Sin full-text por ahora — para 6 usuarios y ~100 tickets/mes, `ILIKE` con `pg_trgm` (que ya viene con Supabase) es más que suficiente.
- **Empty state**: dos casos (`003` pattern):
  - Sin filtros y sin tickets visibles → CTA "Crear el primer ticket" (si el usuario tiene proyecto donde crearlo) o "Todavía no sos miembro de ningún proyecto" (si no).
  - Con filtros → `NoResultsState` nombrando los filtros aplicados.

### 8.3 `/tickets/:key` — detalle

Server Component. Fetch por `key` (parseado a `{ projectKey, numero }` y joined a `projects`).

```
┌────────────────────────────────────────────────────────────────────┐
│  WDW-42 · Importar CSV de clientes                    [ Editar ▾ ]  │
│  Cliente · Proyecto White Label WDW                                 │
├────────────────────────────────────────────────────────────────────┤
│  Estado: [In progress ▼]      Prioridad: [Alta]                     │
│  Asignado a: [Emi ▼]          Creado por: Nico · hace 3 días        │
├────────────────────────────────────────────────────────────────────┤
│  Descripción                                                        │
│  ------------------------------------------------------------------ │
│  <MarkdownViewer />                                                 │
├────────────────────────────────────────────────────────────────────┤
│  Historial (opcional en 015)                                        │
│  → Nico creó el ticket · hace 3 días                                │
│  → Emi movió a "In progress" · hace 2 horas                         │
└────────────────────────────────────────────────────────────────────┘
```

- **Historial** en el detalle: lo hago **opcional en 015**. `audit_log` ya guarda los eventos; renderizarlos requiere un par de queries y componente. Si el scope aprieta, se corta y queda para un follow-up. En `tasks.md` va como F1.
- **Edición inline** vs **dialog**: en el MVP, click en el status/priority/assignee abre un `<Select>` inline que dispara `PATCH` optimista. Para `title` y `description` se abre un dialog con el mismo form del alta pero pre-poblado.
- **Botón "Editar"**: solo se muestra si `canEditTicket(profile, ticket, project)` (helper client-side que replica la lógica del trigger para no permitir intentar operaciones que fallarán). La verdad la sigue teniendo el server; el helper es UX.

### 8.4 Members panel en `/admin/projects/:id`

Se agrega una sub-sección debajo del form de edición del proyecto.

```
┌────────────────────────────────────────────────────────────────────┐
│  Miembros                                              [+ Agregar]  │
├────────────────────────────────────────────────────────────────────┤
│  Nombre         │ Email              │ Rol          │ Activo │      │
│  Nico (PM)      │ nico@...           │ Lead    ▼    │  ☑     │  ⋯   │
│  Emi            │ emi@...            │ Contributor ▼│  ☑     │  ⋯   │
│  Bruno          │ bruno@...          │ Viewer  ▼    │  ☑     │  ⋯   │
└────────────────────────────────────────────────────────────────────┘
```

- La fila del PM del proyecto muestra un badge `(PM)` como aclaración; no se puede desactivar (la protección la hace el UI, no el trigger — un admin con `service_role` sí podría). Motivo: proteger contra "PM se desactivó a sí mismo del proyecto que gestiona por error".
- Agregar: dialog con selector de usuario (autocomplete de `profiles` filtrado por `active = true` y no-ya-miembro) y selector de rol.
- Toggle "Activo": patch a `active` con confirmación si va a `false`.
- Guard de acceso al panel: admin y PM del proyecto (AC-1.1 del spec).

### 8.5 Toolbar y navegación

Se agrega **"Tickets"** al `AppShell` como ítem del nav principal, a la altura de "Calendario" y "Bandeja". El ícono es un ticket outline (Lucide `Ticket`). Ver `DESIGN.md §8`.

---

## 9. Dependencias entre features

- **`002-entities-admin`**: se toca `/admin/projects/:id` para agregar el panel de miembros y el input de `key` en el form de proyecto. `key` es obligatorio en el form al **crear**; en el edit, es editable solo si el proyecto no tiene tickets (feedback visual coherente con el trigger de §5.3).
- **`010-notifications-and-audit`**: se reusa `notify_user()`, `audit_log`, `notifications`. Se agregan dos tipos de evento en `src/lib/notifications/events.ts`. Sin `010`, no habría infra de avisos y `015` no podría cumplir D-1.
- **`012-multiple-roles-and-active-enforcement`**: los helpers de RLS `is_admin()`, `has_role()` y el `active` en las policies vienen de acá.
- **`001-auth-and-permissions`**: sesiones, `auth.uid()`.

**Desbloquea**:

- `016-time-tracking`: `time_entries.ticket_id` apuntará a `tickets`; `project_members` gana `valor_hora_override` (nuevo campo, no migra data); nace `tickets.estimacion_horas` (nueva columna).
- `017-github-integration`: parseo de `#PROJ-N` contra `(projects.key, tickets.numero)`.

---

## 10. Riesgos y mitigaciones

**R-1 — Numeración con carrera.** Cubierto en §5.1 (lock por fila de `projects`). Test de integración: 20 inserts en paralelo en el mismo proyecto, verificar `numero = {1..20}` sin gaps. Si el test falla, el guard es inservible y hay que reescribirlo con secuencia dedicada por proyecto (`create sequence per project` — más caro pero rock-solid). Anotado en `tasks.md` como spike si aparece.

**R-2 — `key` post-backfill: colisiones.** El backfill de §3.2 genera `key` a partir del nombre. Dos proyectos con nombres muy parecidos pueden colisionar (`"WhiteLabel"` y `"White Label"` → ambos `WHITEL`). **Mitigación:** la migration falla en la constraint `unique`. Antes de correr en la base productiva, se corre en CI (regla del CLAUDE.md); si falla, hay una lista concreta de proyectos a renombrar. **Segunda mitigación:** un query pre-flight que se documenta en la PR:

```sql
select
  upper(substring(regexp_replace(nombre, '[^A-Za-z]', '', 'g') from 1 for 6)) as candidate_key,
  array_agg(nombre)
from projects
group by 1
having count(*) > 1;
```

Si devuelve filas, resolver antes de `db:push`.

**R-3 — Contributor guard vs. columna nueva.** El trigger de §5.4 compara `to_jsonb(new) - {'status','updated_at'}` con la vieja. Cualquier columna nueva a `tickets` (por ej. `estimacion_horas` en `016`) nace **cubierta por el guard**: si un contributor manda ese campo en un `PATCH`, el guard rechaza. **Consecuencia**: una migration en `016` que agregue una columna y un handler que la use por defecto en el update **puede romper la respuesta del contributor**. **Mitigación:** documentado explícito en este `plan.md` y en `spec.md` de `016`. Es el precio de la disciplina de whitelist implícita (misma trade-off que ADR 0009 en bookings).

**R-4 — `404` vs `403` en RLS.** El detalle de un ticket que no existe **y** el detalle de un ticket que existe pero no puedo ver **deben devolver el mismo `404`** (AC-6.1 del spec). **Mitigación:** la implementación del handler y de la page siempre hace `select` primero; si `null`, `404`. Si existe pero un `update` posterior es rechazado por trigger, sí es `403`. Test E2E: usuario no-miembro pide `/tickets/WDW-42` (existente), tiene que ver 404 y no 403.

**R-5 — Doble notificación al asignarse el ticket a sí mismo con status change.** Si un contributor se asigna y cambia el status en la misma request, el trigger dispara dos notificaciones al mismo target. **Mitigación:** el trigger de §5.5 chequea `assignee_id is distinct from actor_id` en ambos casos; si el contributor **es** el nuevo asignado, no se le notifica del assign — porque acaba de hacerlo — pero **sí** puede notificarse al creador del status change si es otra persona. Test unitario cubre.

**R-6 — Bloqueo por dependencia entre `010` y `015`.** Si `010` no está mergeado o los helpers de `notify_user()` cambian, la migration falla. **Mitigación:** `010` está `done`. Verificamos con un `select proname from pg_proc where proname = 'notify_user'` al arrancar la migration; si falla, error temprano con mensaje claro. En la práctica, CI catches it.

**R-7 — Markdown y payloads en `audit_log`.** Guardar el `description` completo en `audit_log` (para diff) puede inflar la tabla con textos grandes. **Mitigación:** el trigger de audit (§5.6) marca `description` como `"__changed__"` en el payload, no guarda el contenido nuevo. Si mañana hace falta una función de "revertir a la versión anterior", eso es una tabla `ticket_revisions` aparte — fuera de `015`, y probablemente fuera de `016` también.

**R-8 — El `search_path = public` en `security definer`.** Convención necesaria: sin él, un atacante que controle el schema search path puede inyectar código en la función (CVE clásico de Postgres). **Mitigación:** cada `security definer` explicita `set search_path = public`. Documentado en cada uno.

---

## 11. Alternativas consideradas

- **Un solo tipo `role` unificado (`admin`/`pm`/`developer`/`viewer`/`contributor`/`lead`)** en lugar de dos capas (global + por proyecto). Descartada: mezcla dos ejes ortogonales (qué podés hacer en la app vs. qué en este proyecto) y hace explosivas las combinaciones. Ya está resuelto en ADR 0011 (`012`).
- **Numeración con `sequence` por proyecto.** Es rock-solid contra carreras, pero cada proyecto crea una `sequence` — muchos objetos en el schema y una molestia al borrar. El `update ... returning` con lock de fila (§5.1) es el patrón estándar y funciona. Si R-1 se materializa, esta es la salida.
- **`key` autogenerado inmutable** desde el nombre, sin campo editable. Descartada: los admins quieren nombrar la clave. `PROJ-42` vs. `WDW-42` no es solo cosmético.
- **`status` con workflow rígido** (por ejemplo, `blocked` solo desde `in_progress`). Descartada en el spec (AC-4.2). Si aparece, es un trigger adicional; no migra datos.
- **Vistas persistidas / filtros guardados por usuario**. Descartada: state-in-URL cubre el 90% del caso ("compartí este link"), y "mis filtros" es fase 2 sin costo.
- **CKEditor / TipTap / Notion-like** para markdown. Descartada por peso y complejidad para 6 usuarios: `react-markdown` + textarea + tab de preview es suficiente y muchísimo más chico.
- **Descriptions en HTML sanitizado** en lugar de markdown. Descartada: markdown se lee y se escribe en plain text sin editor, es portable a cualquier herramienta (Slack, GitHub, docs), y el copy/paste desde un README funciona.
- **`project_members` unificado con `project_devs`** (hipotética tabla de la vista Planning, ADR 0007). Descartada: la vista Planning no la necesitó (`011` §3.2 documenta por qué) y meter dos semánticas —"puede ver tickets" y "está asignado a este proyecto"— en la misma tabla las acopla mal. Se decidirá caso por caso.

---

## 12. Testing strategy

- **Unit (sin DB)**:
  - `parseTicketKey('WDW-42')` → `{ projectKey: 'WDW', numero: 42 }`. Casos con guiones raros, mayúsculas, whitespace.
  - `formatTicketKey({ key: 'WDW', numero: 42 })` → `'WDW-42'`.
  - `canEditTicket(profile, ticket, project)` (helper client-side que replica el trigger): cubre cada rol con cada operación (status only, edit propio, edit ajeno, reassign) y espera lo mismo que el trigger.
  - Sanitize de markdown: `<script>...</script>` fuera, `<iframe>` fuera, `javascript:` URLs fuera, links con target normalizados, imágenes descartadas.
  - Filtros de `/tickets`: parser de URL con params bien y mal formados no rompe (cae a defaults).

- **Integración (DB)**:
  - `is_project_member` / `role_in_project` retornan `false`/`null` para usuarios inactivos aunque tengan fila (regla D-01).
  - `is_pm_of_project` retorna `false` si el profile está inactivo.
  - Insert de ticket asigna `numero` correlativo por proyecto (`INSERT` × 20 en paralelo → `{1..20}` sin gaps).
  - Contributor: puede transicionar status ajeno, no puede reasignar, no puede editar `title`/`description` ajeno; sí puede editar los propios.
  - `viewer`: `select` funciona, `insert`/`update` denegado por policy.
  - No-miembro: `select` de un ticket ajeno devuelve 0 filas (no error).
  - Change de `pm_id` en un proyecto: entrante queda `lead`, saliente `contributor` (§5.2 comprobado end-to-end).
  - Backfill de `project_members` para proyectos existentes: el `insert ... on conflict do nothing` es idempotente (correr la migration dos veces no explota).
  - Cambio de `projects.key` en proyecto con tickets falla (trigger de §5.3).
  - `audit_log` recibe una fila por ticket_created, otra por ticket_status_changed, otra por ticket_assignee_changed, y una por ticket_updated con `description` marcada como `__changed__`.

- **Smoke (PostgREST)**:
  - `select ... from tickets` con `?project_id=eq.<X>&order=updated_at.desc` (patrón del listado).
  - `select ... from project_members` con `?project_id=eq.<X>&active=eq.true`.
  - `select ... from tickets` con `?description=ilike.%foo%` (una vez que agreguemos search sobre description, si aplica).

- **E2E (Playwright)**:
  - Admin crea proyecto con `key = 'WDW'` → verifica que se puebla `project_members` con el PM.
  - PM invita a Emi como `contributor` → Emi ve `/tickets`, no ve tickets de proyectos ajenos.
  - Emi crea ticket `WDW-1` → PM ve la notificación in-app (asigna a otra persona).
  - Contributor cambia status → creador y asignado reciben aviso; el actor no recibe el suyo propio.
  - No-miembro pide `/tickets/WDW-1` → 404 (crítico, AC-6.1 del spec).
  - Admin cambia `key` en proyecto sin tickets → OK; agrega un ticket; intenta cambiar `key` → error.

- **Manual (ojos)**:
  - Markdown viewer con contenidos variados (headings, listas, tablas, código, links, task lists) contra `DESIGN.md`.
  - Densidad de la tabla de `/tickets` con 30, 100, 300 filas.
  - Estados vacío / sin resultados / error / loading en `/tickets` y `/tickets/:key`.
  - Miembros panel: agregar, cambiar rol, desactivar, reactivar; con badge de PM primario.

---

## 13. Rollout

- **Sin feature flag.** Es una feature nueva completa (rutas, endpoints, tablas): esconderla detrás de un flag ambiental agrega complejidad sin beneficio — no reemplaza nada existente que pueda seguir usándose en paralelo. El equipo la usa desde el merge.
- **Migration**: una sola. Orden interno (definido en §5):
  1. Enums.
  2. Extensiones a `projects` (`key`, `next_ticket_number`) — nullable primero, backfill, `not null` + check.
  3. Tablas `project_members`, `tickets` con FKs, unique, checks e índices.
  4. Helpers (`is_project_member`, `role_in_project`, `is_pm_of_project`, `can_view_project`).
  5. Grants a `authenticated`.
  6. Policies RLS.
  7. Triggers en orden: numeración, auto-add PM, key immutable, contributor scope, notify, audit.
  8. Backfill de `project_members` para proyectos existentes.
- **Regla del CLAUDE.md**: "primero la migration, después el deploy". Concretamente:
  1. Merge de la migration a `main` y `pnpm db:push` contra el proyecto de Supabase.
  2. Verificar `db:types` regenera y no hay drift.
  3. Deploy de Vercel se dispara solo con el push a `main`.
  4. Rollout monitoreado: no hay downtime esperado (agrega columnas, no toca las viejas).
- **Plan de rollback**: la migration **no tiene down migration escrita** (patrón del proyecto — no hay `db:reset` a propósito). Rollback = una migration nueva que hace lo inverso: drop de triggers, drop de tablas, drop de columnas de `projects`. **En la práctica, no se hace rollback**: los tickets creados en el intervalo se perderían. Si algo sale mal, se **arregla hacia adelante** con otra migration.
- **Sin `staff` todavía.** Este slug **no** toca el enum de roles. `staff` entra en `016`, y hasta entonces los miembros del proyecto son `admin`/`pm`/`developer`. Un contador de administración que sea miembro de un proyecto debe tener rol `developer` **temporalmente** (o esperar a `016`). Anotarlo en el rollout comm al equipo.
- **Comunicación al equipo**: un mensaje corto que cubra (a) qué es la clave `PROJ-N`, (b) cómo se agregan miembros, (c) cómo se cita un ticket en un commit (aunque el link automático viene en `017`).
