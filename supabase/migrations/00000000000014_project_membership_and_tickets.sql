-- Feature: 015-project-membership-and-tickets
-- Purpose: modelar la unidad de trabajo (tickets) dentro de un proyecto, con
--          membresía explícita por proyecto (project_members) que define quién
--          los ve y edita. Base para 016-time-tracking (los time_entries van a
--          apuntar a un ticket) y 017-github-integration (los commits se linkean
--          por convención #PROJ-N contra los tickets locales).
--
-- READ specs/features/015-project-membership-and-tickets/plan.md §4 y §5 BEFORE
-- EDITING. Cuatro reglas que se rompen fácil y hacen fallar la RLS en silencio:
--
--   1. La granularidad fina del contributor (edita propios, transiciona
--      cualquiera, no reasigna) vive en un TRIGGER, no en la policy. La RLS de
--      Postgres no sabe expresar "solo estas columnas" (ADR 0009). Cualquier
--      intento de meterla en `with check` es papelera.
--
--   2. La numeración PROJ-N se serializa con un `update ... returning` sobre la
--      fila de projects, que toma lock de fila. No es un `sequence`, no es un
--      `count(*)+1`, no es un `max(numero)+1`. Ver §5.1 del plan.
--
--   3. Los helpers `security definer` incluyen el chequeo de `active = true`
--      ADENTRO (regla D-01, CLAUDE.md §Roles y active). Ningún consumidor puede
--      olvidarlo si no vive en la función.
--
--   4. Cambiar projects.key en un proyecto con tickets rompe referencias
--      externas (Slack, commits, mensajes). enforce_project_key_immutable es la
--      única defensa dura.
--
-- Migration aditiva: enums nuevos, columnas nuevas nullable → backfill → not
-- null + constraints, tablas nuevas, funciones nuevas, triggers nuevos. Nada
-- existente se modifica de forma que rompa código deployado. La regla de dos
-- fases del CLAUDE.md se cumple sin segunda migration.
--
-- Pre-flight de colisiones de `projects.key` (plan.md R-2) corrido antes del
-- push contra el proyecto de Supabase: 29 proyectos, 29 keys candidatas únicas,
-- 0 colisiones. Script: `scripts/preflight-015-project-keys.mjs`. Si mañana se
-- reintenta la migration sobre una base con datos distintos, re-correr antes.

-- ─────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────
-- project_member_role: la jerarquía es lineal (viewer < contributor < lead)
-- pero el código compara por igualdad explícita, no por orden — así el orden
-- del enum es documental y agregar un cuarto rol en el medio no rompe nada.
create type public.project_member_role as enum ('viewer', 'contributor', 'lead');

-- ticket_status: los seis estados del MVP. Ninguna transición está prohibida
-- (AC-4.2 del spec) — la disciplina la lleva el equipo, y un workflow duro se
-- agrega después como trigger sin migrar datos.
create type public.ticket_status as enum (
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled'
);

-- ticket_priority: cuatro niveles. `medium` es el default de creación.
create type public.ticket_priority as enum ('low', 'medium', 'high', 'critical');

-- ─────────────────────────────────────────────────────────────
-- 2. Extensión de projects: key + next_ticket_number
-- ─────────────────────────────────────────────────────────────
-- Se agrega en tres pasos, no en uno: nullable → backfill → not null + check +
-- unique. El orden importa porque la primera fila con `key = null` violaría el
-- `not null`, y el backfill no puede correr si el `unique` ya está en su lugar
-- y colisiona.
alter table public.projects
  add column key varchar(8),
  add column next_ticket_number int not null default 1;

-- Backfill: derivar key del nombre.
--   1. regexp_replace(name, '[^A-Za-z]', '', 'g') → deja solo letras.
--   2. substring(... from 1 for 6) → primeras 6 letras.
--   3. upper(...) → mayúscula (el check exige [A-Z][A-Z0-9]{1,7}).
--   4. coalesce con 'PROJ' → fallback si el nombre no tiene letras (defensivo).
update public.projects
set key = coalesce(
  nullif(upper(substring(regexp_replace(name, '[^A-Za-z]', '', 'g') from 1 for 6)), ''),
  'PROJ'
)
where key is null;

alter table public.projects
  alter column key set not null,
  add constraint projects_key_format check (key ~ '^[A-Z][A-Z0-9]{1,7}$'),
  add constraint projects_key_unique unique (key);

-- ─────────────────────────────────────────────────────────────
-- 3. project_members
-- ─────────────────────────────────────────────────────────────
-- La membresía por proyecto complementa los roles globales (012). El rol global
-- dice qué podés hacer en la app; project_members dice a qué proyecto tenés
-- acceso y con qué scope.
--
-- Sobre los `on delete`:
--   - project_id → cascade: los proyectos no se borran en la app (se desactivan
--     con `active = false`), pero si un admin borra uno con service_role,
--     cascadear miembros es correcto — no son historia. La historia queda en
--     audit_log.
--   - user_id → restrict: los profiles tampoco se borran (se desactivan). Si
--     alguien intenta borrar un profile con service_role y tiene membresías,
--     la operación falla — se lo obliga a desactivar. Dura a propósito.
create table public.project_members (
  id                uuid                       primary key default gen_random_uuid(),
  project_id        uuid                       not null references public.projects(id) on delete cascade,
  user_id           uuid                       not null references public.profiles(id) on delete restrict,
  role_in_project   public.project_member_role not null default 'contributor',
  active            boolean                    not null default true,
  created_at        timestamptz                not null default now(),
  updated_at        timestamptz                not null default now(),
  unique (project_id, user_id)
);

-- Índices parciales `where active = true`: las queries dominantes (¿qué proyectos
-- tiene este usuario?, ¿quiénes son miembros de este proyecto?) filtran por
-- active en el 99% de los casos. Un índice sobre la parte activa es más chico y
-- más rápido de mantener; el 1% restante (listar todos, incluyendo desactivados)
-- va a full scan y no importa.
create index project_members_user_active_idx
  on public.project_members (user_id) where active = true;
create index project_members_project_active_idx
  on public.project_members (project_id) where active = true;

-- El trigger de updated_at ya existe (set_updated_at, migration 00). Se reusa.
create trigger project_members_set_updated_at
  before update on public.project_members
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 4. tickets
-- ─────────────────────────────────────────────────────────────
-- La unidad de trabajo del producto. `numero` lo asigna un trigger (§9) con
-- lock de fila sobre projects; la unique (project_id, numero) es la garantía
-- dura contra duplicados y contra código que se olvide del trigger.
--
-- Sobre los `on delete`:
--   - project_id → restrict: los proyectos no se borran; si alguien intenta con
--     service_role y hay tickets, falla. Correcto: los tickets son historia y
--     necesitan su proyecto aunque esté inactivo.
--   - created_by → restrict: idem para el creador. Se puede desactivar; borrar
--     falla si hay tickets creados por esa persona.
--   - assignee_id → set null: es una asignación, no una autoría. Si el
--     asignado se borra, el ticket queda huérfano pero no se pierde.
--
-- `description` guarda markdown crudo; el sanitizado se hace en el render, no
-- en el write. Motivo: sanitizar al escribir descarta información que un
-- cambio futuro del sanitizer podría querer preservar; sanitizar al leer
-- permite afinar el filtro sin migrar datos.
create table public.tickets (
  id           uuid                    primary key default gen_random_uuid(),
  project_id   uuid                    not null references public.projects(id) on delete restrict,
  numero       int                     not null,
  title        text                    not null check (length(title) between 1 and 200),
  description  text,
  status       public.ticket_status    not null default 'todo',
  priority     public.ticket_priority  not null default 'medium',
  assignee_id  uuid                    references public.profiles(id) on delete set null,
  created_by   uuid                    not null references public.profiles(id) on delete restrict,
  created_at   timestamptz             not null default now(),
  updated_at   timestamptz             not null default now(),
  unique (project_id, numero)
);

-- Índices:
--   - (project_id, status, updated_at desc): la query dominante del listado
--     — tickets abiertos del proyecto X ordenados por lo último.
--   - assignee_id parcial: filtro "asignado a mí" y "sin asignar".
--   - created_by: para la regla del contributor (edita lo propio).
create index tickets_project_status_updated_idx
  on public.tickets (project_id, status, updated_at desc);
create index tickets_assignee_idx
  on public.tickets (assignee_id) where assignee_id is not null;
create index tickets_created_by_idx
  on public.tickets (created_by);

create trigger tickets_set_updated_at
  before update on public.tickets
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 5. Helpers de autorización
-- ─────────────────────────────────────────────────────────────
-- Regla D-01 (CLAUDE.md §Roles y active) aplicada a cada uno: el chequeo de
-- `active = true` va ADENTRO de la función, no se le pide al consumidor que se
-- acuerde. Una policy tiene un solo tiro y un chequeo externo se olvida.
--
-- Los cinco toman un parámetro `p_user_id` con default `auth.uid()`. La forma
-- default sirve para RLS (`is_project_member(new.project_id)`); la explícita
-- sirve para tests de integración que precisan chequear con un usuario
-- particular (patrón de reallocate_booking en 006).

-- is_admin: sugar sobre has_role('admin'), pero con parámetro p_user_id. La
-- alternativa era usar has_role() directamente en cada callsite, pero eso
-- desalinea las funciones — todas las demás toman p_user_id, esta también.
create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = p_user_id
      and active
      and 'admin' = any(roles)
  );
$$;

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
    from public.project_members pm
    join public.profiles pr on pr.id = pm.user_id
    where pm.project_id = p_project_id
      and pm.user_id    = p_user_id
      and pm.active     = true
      and pr.active     = true
  );
$$;

create or replace function public.role_in_project(
  p_project_id uuid,
  p_user_id    uuid default auth.uid()
) returns public.project_member_role
language sql
stable
security definer
set search_path = public
as $$
  select pm.role_in_project
  from public.project_members pm
  join public.profiles pr on pr.id = pm.user_id
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
    from public.projects p
    join public.profiles pr on pr.id = p_user_id
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

revoke all on function public.is_admin(uuid) from public;
revoke all on function public.is_project_member(uuid, uuid) from public;
revoke all on function public.role_in_project(uuid, uuid) from public;
revoke all on function public.is_pm_of_project(uuid, uuid) from public;
revoke all on function public.can_view_project(uuid, uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_project_member(uuid, uuid) to authenticated;
grant execute on function public.role_in_project(uuid, uuid) to authenticated;
grant execute on function public.is_pm_of_project(uuid, uuid) to authenticated;
grant execute on function public.can_view_project(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 6. Grants a authenticated
-- ─────────────────────────────────────────────────────────────
-- Sin grant explícito, la policy deniega en silencio (CLAUDE.md §Migrations).
-- Nada de `delete` a authenticated en ninguna de las dos: los tickets se
-- cancelan con `status = 'cancelled'`, los miembros se desactivan.
-- service_role tiene todo por default.
grant select, insert, update on public.project_members to authenticated;
grant select, insert, update on public.tickets to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 7. RLS de project_members
-- ─────────────────────────────────────────────────────────────
-- Lectura para cualquiera que ve el proyecto (incluye admin, PM primario y
-- miembros): quien puede ver el proyecto puede ver quiénes lo trabajan. Un
-- `lead` NO administra miembros — solo admin y PM primario. Es simple y
-- suficiente al equipo actual.
alter table public.project_members enable row level security;

create policy "project_members: read for visible projects"
  on public.project_members for select
  to authenticated
  using (public.can_view_project(project_id));

create policy "project_members: admin/PM insert"
  on public.project_members for insert
  to authenticated
  with check (
    public.is_admin() or public.is_pm_of_project(project_id)
  );

create policy "project_members: admin/PM update"
  on public.project_members for update
  to authenticated
  using (public.is_admin() or public.is_pm_of_project(project_id))
  with check (public.is_admin() or public.is_pm_of_project(project_id));

-- ─────────────────────────────────────────────────────────────
-- 8. RLS de tickets
-- ─────────────────────────────────────────────────────────────
-- La granularidad fina del contributor (edita propios, transiciona cualquiera,
-- no reasigna) vive en el trigger enforce_ticket_contributor_scope (§12), NO
-- en la policy — la RLS no distingue columnas (ADR 0009). La policy es amplia
-- por eso: es el mismo patrón que `bookings: developer responds`.
--
-- Proyecto inactivo bloquea alta pero permite edit (patrón D-08, migration
-- 10): el `and active` va en el `with check` del insert, NO en el del update.
-- Editar y cancelar tickets viejos de un proyecto desactivado se sigue
-- pudiendo — es lo que un PM necesita para limpiar después de dar de baja.
alter table public.tickets enable row level security;

create policy "tickets: read for project members"
  on public.tickets for select
  to authenticated
  using (public.can_view_project(project_id));

create policy "tickets: contributor+ insert"
  on public.tickets for insert
  to authenticated
  with check (
    (
      public.is_admin()
      or public.is_pm_of_project(project_id)
      or public.role_in_project(project_id) in ('contributor', 'lead')
    )
    and exists (
      select 1 from public.projects p
      where p.id = tickets.project_id and p.active
    )
  );

create policy "tickets: contributor+ update"
  on public.tickets for update
  to authenticated
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

-- ─────────────────────────────────────────────────────────────
-- 9. Trigger: numeración correlativa (assign_ticket_number)
-- ─────────────────────────────────────────────────────────────
-- La numeración PROJ-N se serializa con el update ... returning sobre la fila
-- de projects. Postgres toma lock de fila en el update, así que dos inserts
-- concurrentes al mismo proyecto se serializan sobre esa fila: el segundo
-- espera, ve next_ticket_number ya incrementado, y toma el siguiente. Es el
-- patrón estándar sin SELECT ... FOR UPDATE explícito.
--
-- NO es un sequence: los sequences no rollbackean (gaps al abortar) y crear
-- uno por proyecto es un objeto de schema por proyecto, molesto de mantener.
-- NO es max(numero)+1: en concurrencia genera duplicados con carrera clásica.
--
-- La cláusula `when (new.numero is null)` deja pasar seeds/fixtures que
-- explícitamente setean numero — útil para tests.
create or replace function public.assign_ticket_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_num int;
begin
  update public.projects
     set next_ticket_number = next_ticket_number + 1
   where id = new.project_id
   returning next_ticket_number - 1 into next_num;

  if next_num is null then
    raise exception 'Project % not found while assigning ticket number', new.project_id
      using errcode = '23503'; -- foreign_key_violation
  end if;

  new.numero := next_num;
  return new;
end;
$$;

revoke all on function public.assign_ticket_number() from public;

create trigger tickets_assign_number
  before insert on public.tickets
  for each row
  when (new.numero is null)
  execute function public.assign_ticket_number();

-- ─────────────────────────────────────────────────────────────
-- 10. Trigger: auto-add del PM primario como lead + backfill
-- ─────────────────────────────────────────────────────────────
-- Al crear un proyecto o cambiar de pm_id: promover al entrante a lead
-- (upsert). Al cambiar de pm_id: degradar al saliente a contributor (D-6 del
-- plan). El saliente NO pierde membresía — puede haber creado tickets, seguido
-- el proyecto, o querer verlo. La baja se hace manualmente si corresponde.
create or replace function public.autoadd_pm_as_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pm_id is not null then
    insert into public.project_members (project_id, user_id, role_in_project, active)
    values (new.id, new.pm_id, 'lead', true)
    on conflict (project_id, user_id) do update
      set role_in_project = 'lead',
          active          = true,
          updated_at      = now();
  end if;

  if tg_op = 'UPDATE'
     and old.pm_id is not null
     and old.pm_id is distinct from new.pm_id then
    update public.project_members
       set role_in_project = 'contributor',
           updated_at      = now()
     where project_id      = new.id
       and user_id         = old.pm_id
       and role_in_project = 'lead';
  end if;

  return new;
end;
$$;

revoke all on function public.autoadd_pm_as_lead() from public;

create trigger projects_autoadd_pm_as_lead
  after insert or update of pm_id on public.projects
  for each row execute function public.autoadd_pm_as_lead();

-- Backfill: para cada proyecto existente, agregar al PM primario como lead.
-- Idempotente: `on conflict do nothing` permite re-correr sin efectos. Se
-- ejecuta acá y no antes porque necesita la tabla project_members (§3) y el
-- constraint unique(project_id, user_id).
insert into public.project_members (project_id, user_id, role_in_project, active)
select id, pm_id, 'lead', true
from public.projects
where pm_id is not null
on conflict (project_id, user_id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 11. Trigger: inmutabilidad de projects.key con tickets existentes
-- ─────────────────────────────────────────────────────────────
-- Cambiar la key en un proyecto que ya tiene tickets rompe todo lo que la
-- referencia externamente (Slack, commits, mensajes que dicen #WDW-42). Este
-- trigger es la única defensa dura — el UI puede ayudar mostrando el campo
-- deshabilitado, pero cualquiera con service_role o un update por API se lo
-- saltea si no hay guard adentro.
create or replace function public.enforce_project_key_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.key is distinct from new.key
     and exists (select 1 from public.tickets where project_id = new.id limit 1) then
    raise exception 'Cannot change key of project % once it has tickets', new.id
      using errcode = '23514', -- check_violation
            hint    = 'La clave del proyecto ya está en uso por tickets creados.';
  end if;
  return new;
end;
$$;

create trigger projects_enforce_key_immutable
  before update of key on public.projects
  for each row execute function public.enforce_project_key_immutable();

-- ─────────────────────────────────────────────────────────────
-- 12. Trigger: guard de scope del contributor
-- ─────────────────────────────────────────────────────────────
-- Análogo al guard de bookings de ADR 0009. La policy de update es amplia;
-- este trigger achica.
--
-- Reglas del contributor:
--   1. Reasignar (cambiar assignee_id) es solo lead+.
--   2. Cambio de status únicamente (con updated_at por el trigger de touch):
--      siempre permitido — es colaborativo.
--   3. Edit completo: solo si el ticket es propio (creado o asignado a mí).
--
-- La whitelist es de LO QUE PUEDE cambiar mediante status-only, no de lo
-- prohibido. `to_jsonb(new) - {'status','updated_at'} = to_jsonb(old) - {...}`
-- compara todo excepto esas dos columnas. Cualquier columna nueva que agregue
-- una feature futura (por ej. estimacion_horas en 016) nace protegida: un
-- contributor no puede tocarla mediante status-only. Es el patrón ADR 0009.
--
-- Consecuencia práctica: una migration en 016 que agregue una columna a
-- tickets Y un handler que la mande en un PATCH junto con un cambio de status
-- puede romper la respuesta del contributor. Anotado en R-3 del plan.
create or replace function public.enforce_ticket_contributor_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id           uuid := auth.uid();
  actor_project_role public.project_member_role;
  status_only_change boolean;
begin
  -- service_role llega con auth.uid() = null y pasa: es seed/fixture o admin
  -- de emergencia. Admin y PM del proyecto también pasan sin chequeo.
  if actor_id is null
     or public.is_admin(actor_id)
     or public.is_pm_of_project(old.project_id, actor_id) then
    return new;
  end if;

  actor_project_role := public.role_in_project(old.project_id, actor_id);

  if actor_project_role = 'lead' then
    return new;
  end if;

  -- Viewer no debería llegar (RLS lo rechaza), pero defensivo:
  if actor_project_role is null or actor_project_role = 'viewer' then
    raise exception 'No permission to update ticket'
      using errcode = '23514'; -- check_violation
  end if;

  -- contributor:
  -- 1) Reasignar es lead+ solamente.
  if new.assignee_id is distinct from old.assignee_id then
    raise exception 'Only lead can reassign tickets'
      using errcode = '23514',
            hint    = 'Solo un lead o admin puede cambiar el asignado.';
  end if;

  -- 2) Cambio de status únicamente: siempre permitido (colaborativo).
  status_only_change :=
    (to_jsonb(new) - array['status', 'updated_at']::text[])
    = (to_jsonb(old) - array['status', 'updated_at']::text[]);

  if status_only_change then
    return new;
  end if;

  -- 3) Edit completo: solo si es propio (creado o asignado a mí).
  if old.created_by = actor_id or old.assignee_id = actor_id then
    return new;
  end if;

  raise exception 'Contributor can only transition status or edit own tickets'
    using errcode = '23514',
          hint    = 'Podés cambiar solo el estado de este ticket. Para editar otros campos, pedile a un lead.';
end;
$$;

revoke all on function public.enforce_ticket_contributor_scope() from public;

create trigger tickets_enforce_contributor_scope
  before update on public.tickets
  for each row execute function public.enforce_ticket_contributor_scope();

-- ─────────────────────────────────────────────────────────────
-- 13. Notificaciones de tickets
-- ─────────────────────────────────────────────────────────────
-- Extiende la tabla `notifications` (migration 11) con `ticket_id` y admite
-- dos tipos nuevos (`ticket_assigned`, `ticket_status_changed`). Un helper
-- paralelo `notify_user_for_ticket` mantiene la regla "no me avises de lo mío"
-- en un solo lugar — sigue viviendo cerca de notify_user, no en cada trigger.
--
-- Sobre `ticket_id → on delete cascade`: consistente con `booking_id`. Los
-- tickets no se borran (se cancelan), pero si un admin con service_role
-- eliminara uno, la notificación asociada dejaría de tener referencia y
-- ensuciaría la bandeja.

alter table public.notifications
  add column ticket_id uuid references public.tickets(id) on delete cascade;

-- Extender el check constraint del `type` para incluir los dos nuevos. Como el
-- constraint fue definido inline sin nombre explícito, Postgres lo nombró
-- automáticamente; el do-block lo busca por contenido para no depender del
-- nombre autogenerado.
do $$
declare
  ctname text;
begin
  select conname into ctname
  from pg_constraint
  where conrelid = 'public.notifications'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%booking_created%';
  if ctname is not null then
    execute format('alter table public.notifications drop constraint %I', ctname);
  end if;
end
$$;

alter table public.notifications
  add constraint notifications_type_check check (type in (
    'booking_created',
    'booking_approved',
    'booking_rejected',
    'booking_cancelled',
    'booking_needs_reapproval',
    'booking_displaced',
    'ticket_assigned',
    'ticket_status_changed'
  ));

-- Helper paralelo a notify_user (migration 11) para tickets. Mantiene la
-- invariante AC-1.6 ("no me avises de lo mío") en un único lugar.
create or replace function public.notify_user_for_ticket(
  target_recipient     uuid,
  notification_type    text,
  target_ticket        uuid,
  notification_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_recipient is null then
    return;
  end if;

  if auth.uid() is not null and target_recipient = auth.uid() then
    return;
  end if;

  insert into public.notifications (recipient_id, ticket_id, type, payload)
  values (target_recipient, target_ticket, notification_type, notification_payload);
end;
$$;

revoke all on function public.notify_user_for_ticket(uuid, text, uuid, jsonb) from public;

-- El trigger guarda HECHOS (ids, status crudos, actor), no oraciones — el copy
-- lo arma src/lib/notifications/events.ts (ADR 0012), y así cambiar el texto
-- no necesita migration.
--
-- Casos de disparo:
--   INSERT — assigned distinto del actor → ticket_assigned
--   UPDATE de assignee_id — nuevo assigned distinto del actor → ticket_assigned
--   UPDATE de status — al asignado (si no es actor); y al creador (si no es
--     actor y no es el mismo asignado, para no duplicar).
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
      perform public.notify_user_for_ticket(
        new.assignee_id,
        'ticket_assigned',
        new.id,
        jsonb_build_object(
          'project_id',  new.project_id,
          'title',       new.title,
          'assigned_by', actor_id
        )
      );
    end if;
    return null;
  end if;

  -- UPDATE

  if new.assignee_id is distinct from old.assignee_id
     and new.assignee_id is not null
     and new.assignee_id is distinct from actor_id then
    perform public.notify_user_for_ticket(
      new.assignee_id,
      'ticket_assigned',
      new.id,
      jsonb_build_object(
        'project_id',           new.project_id,
        'title',                new.title,
        'assigned_by',          actor_id,
        'previous_assignee_id', old.assignee_id
      )
    );
  end if;

  if new.status is distinct from old.status then
    if new.assignee_id is not null
       and new.assignee_id is distinct from actor_id then
      perform public.notify_user_for_ticket(
        new.assignee_id,
        'ticket_status_changed',
        new.id,
        jsonb_build_object(
          'project_id',  new.project_id,
          'title',       new.title,
          'from_status', old.status::text,
          'to_status',   new.status::text,
          'changed_by',  actor_id
        )
      );
    end if;

    -- Al creador si no es actor y no es el asignado (evita el doble aviso).
    if new.created_by is distinct from actor_id
       and new.created_by is distinct from new.assignee_id then
      perform public.notify_user_for_ticket(
        new.created_by,
        'ticket_status_changed',
        new.id,
        jsonb_build_object(
          'project_id',  new.project_id,
          'title',       new.title,
          'from_status', old.status::text,
          'to_status',   new.status::text,
          'changed_by',  actor_id
        )
      );
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.notify_ticket_events() from public;

create trigger tickets_notify_events
  after insert or update of assignee_id, status on public.tickets
  for each row execute function public.notify_ticket_events();

-- ─────────────────────────────────────────────────────────────
-- 14. Audit log de tickets y project_members
-- ─────────────────────────────────────────────────────────────
-- audit_log ya existe (migration 03). Se agregan dos entidades más:
--   entity = 'ticket'          → create, status_change, assignee_change, update
--   entity = 'project_member'  → create, role_change, deactivated
--
-- La regla de ADR 0012 se sigue: la fila la escribe un trigger en la misma
-- transacción que el evento; si el evento existe, el rastro existe.
--
-- description NO viaja en el diff (R-7): puede ser larga y ensuciar la tabla.
-- Se marca como '__changed__' cuando cambió.

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
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'ticket', new.id, 'create', actor_id,
      jsonb_build_object(
        'title',       new.title,
        'priority',    new.priority,
        'assignee_id', new.assignee_id,
        'project_id',  new.project_id,
        'status',      new.status
      )
    );
    return null;
  end if;

  -- UPDATE: filas específicas para status y assignee (fáciles de consultar
  -- después), más una genérica para el resto.

  if new.status is distinct from old.status then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'ticket', new.id, 'status_change', actor_id,
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'ticket', new.id, 'assignee_change', actor_id,
      jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id)
    );
  end if;

  -- Diff genérico: excluye status/assignee_id (ya cubiertos) y updated_at.
  diff := (to_jsonb(new) - array['status','assignee_id','updated_at']::text[])
        - (to_jsonb(old) - array['status','assignee_id','updated_at']::text[]);

  if diff <> '{}'::jsonb then
    if diff ? 'description' then
      diff := jsonb_set(diff, '{description}', to_jsonb('__changed__'::text));
    end if;
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values ('ticket', new.id, 'update', actor_id, diff);
  end if;

  return null;
end;
$$;

revoke all on function public.audit_ticket_events() from public;

create trigger tickets_audit
  after insert or update on public.tickets
  for each row execute function public.audit_ticket_events();

create or replace function public.audit_project_member_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'project_member', new.id, 'create', actor_id,
      jsonb_build_object(
        'project_id',      new.project_id,
        'user_id',         new.user_id,
        'role_in_project', new.role_in_project
      )
    );
    return null;
  end if;

  if new.role_in_project is distinct from old.role_in_project then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'project_member', new.id, 'role_change', actor_id,
      jsonb_build_object('from', old.role_in_project, 'to', new.role_in_project)
    );
  end if;

  if new.active is distinct from old.active then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'project_member', new.id, case when new.active then 'reactivated' else 'deactivated' end, actor_id,
      jsonb_build_object('user_id', new.user_id, 'project_id', new.project_id)
    );
  end if;

  return null;
end;
$$;

revoke all on function public.audit_project_member_events() from public;

create trigger project_members_audit
  after insert or update on public.project_members
  for each row execute function public.audit_project_member_events();
