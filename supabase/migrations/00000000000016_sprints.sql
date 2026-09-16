-- ─────────────────────────────────────────────────────────────
-- 018 · Sprints y reporte de fin de sprint
-- ─────────────────────────────────────────────────────────────
-- Tabla `sprints` por proyecto con ciclo planned → active → completed.
-- Extensiones a `tickets` (sprint_id, estimated_hours) y a `projects`
-- (next_sprint_number). Triggers de numeración correlativa y de
-- transiciones de status. Extensión del trigger enforce_ticket_contributor_scope
-- para bloquear a contributors de cambiar sprint_id / estimated_hours.
-- RPC close_sprint_with_rollover que hace el cierre transaccional
-- (snapshot antes, update de tickets, update del sprint).
--
-- Two-phase safe: cero remoción, cero cambio de tipos. El código
-- deployado hoy no toca sprint_id ni estimated_hours; sus UPDATE de
-- tickets no cambian los campos nuevos (old = new = null) y el trigger
-- extendido no rechaza.
-- ─────────────────────────────────────────────────────────────

-- 1. Enum ─────────────────────────────────────────────────────
create type public.sprint_status as enum ('planned', 'active', 'completed');

-- 2. Extensión de projects ────────────────────────────────────
-- Contador auto-incrementable de sprints por proyecto, análogo a
-- next_ticket_number de 015.
alter table public.projects
  add column next_sprint_number int not null default 1;

-- 3. Tabla sprints ────────────────────────────────────────────
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

  constraint sprints_dates_ok
    check (ends_at >= starts_at),

  -- La coherencia del cierre queda dura en la base: un `completed` sin
  -- snapshot ni `closed_at` es un bug garantizado que no puede escribirse.
  -- El RPC de cierre setea los tres campos en una sola transacción.
  constraint sprints_completed_has_closed_at
    check (
      (status = 'completed' and closed_at is not null and report is not null)
      or (status <> 'completed' and closed_at is null and report is null)
    ),

  constraint sprints_numero_unique_per_project unique (project_id, numero)
);

-- Un solo sprint activo por proyecto, garantía dura. Una race de dos PMs
-- clickeando "Activar" a la vez cae acá con 23505 — la UI colabora escondiendo
-- el botón, pero esta es la defensa de segunda línea.
create unique index sprints_one_active_per_project
  on public.sprints (project_id)
  where status = 'active';

create index sprints_project_status_idx
  on public.sprints (project_id, status);

-- Índice para buscar planificados por fecha (rollover elige el próximo).
create index sprints_project_planned_starts_idx
  on public.sprints (project_id, starts_at)
  where status = 'planned';

-- 4. Extensión de tickets ─────────────────────────────────────
-- `on delete set null`: convención del proyecto para FKs históricas.
-- Un sprint no se borra en la práctica; si algún día se hiciera, los tickets
-- vuelven al backlog en vez de romperse.
alter table public.tickets
  add column sprint_id       uuid references public.sprints(id) on delete set null,
  add column estimated_hours numeric(5, 2)
    check (estimated_hours is null or estimated_hours >= 0);

create index tickets_sprint_idx
  on public.tickets (sprint_id)
  where sprint_id is not null;

-- 5. Trigger de numeración correlativa ────────────────────────
-- Mismo patrón que assign_ticket_number de 015: lockea la fila de projects
-- con `update ... returning`, asigna número, incrementa.
create or replace function public.assign_sprint_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
begin
  if new.numero is not null then
    return new;
  end if;

  update public.projects
     set next_sprint_number = next_sprint_number + 1
   where id = new.project_id
  returning next_sprint_number - 1 into v_next;

  if v_next is null then
    raise exception 'Project % not found', new.project_id
      using errcode = '23503';
  end if;

  new.numero := v_next;
  return new;
end;
$$;

revoke all on function public.assign_sprint_number() from public;

create trigger sprints_assign_number
  before insert on public.sprints
  for each row execute function public.assign_sprint_number();

-- 6. Trigger de transiciones de status ────────────────────────
-- planned → active: OK (la unique parcial garantiza único activo).
-- active → completed: OK **solo si closed_at y report están seteados**.
--                     Es la protección que impide cerrar sin snapshot: el RPC
--                     de cierre siempre setea los tres campos junto con status,
--                     y cualquier otro camino de cierre estaría mal escrito.
-- Cualquier otra transición: prohibida. Nadie vuelve de completed.
create or replace function public.enforce_sprint_status_transitions()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'planned' and new.status = 'active' then
    return new;
  end if;

  if old.status = 'active' and new.status = 'completed' then
    if new.closed_at is null or new.report is null then
      raise exception 'Cannot mark sprint completed without closed_at and report'
        using errcode = '23514',
              hint    = 'El cierre pasa por el RPC close_sprint_with_rollover.';
    end if;
    return new;
  end if;

  raise exception 'Sprint transition % → % not allowed', old.status, new.status
    using errcode = '23514';
end;
$$;

create trigger sprints_enforce_status_transitions
  before update of status on public.sprints
  for each row execute function public.enforce_sprint_status_transitions();

-- Trigger de touch de updated_at.
create or replace function public.touch_sprint_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger sprints_touch_updated_at
  before update on public.sprints
  for each row execute function public.touch_sprint_updated_at();

-- 7. Extensión de enforce_ticket_contributor_scope ────────────
-- 015 T1.12 declaró que el trigger es la verdad de "qué puede tocar un
-- contributor". 018 extiende esa verdad con dos campos nuevos que NO son de
-- contributor: `sprint_id` (planificación) y `estimated_hours` (planning).
-- Estos checks van ANTES del path "3) Edit completo: solo si es propio"
-- porque queremos que ni el creator ni el assignee (siendo contributor)
-- puedan cambiarlos — es planning, no ejecución.
--
-- El diff genérico (líneas 570-571 del original, ya arreglado por migration 15
-- vía `audit_ticket_events`) sigue funcionando: sprint_id y estimated_hours
-- que cambien en un update junto con status van a hacer que status_only_change
-- sea false, y sin este check explícito caerían al "3) Edit completo". Con
-- este check, se rechazan antes.
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
  -- service_role llega con auth.uid() = null y pasa. Admin y PM también.
  if actor_id is null
     or public.is_admin(actor_id)
     or public.is_pm_of_project(old.project_id, actor_id) then
    return new;
  end if;

  actor_project_role := public.role_in_project(old.project_id, actor_id);

  if actor_project_role = 'lead' then
    return new;
  end if;

  if actor_project_role is null or actor_project_role = 'viewer' then
    raise exception 'No permission to update ticket'
      using errcode = '23514';
  end if;

  -- contributor:
  -- 1) Reasignar es lead+ solamente.
  if new.assignee_id is distinct from old.assignee_id then
    raise exception 'Only lead can reassign tickets'
      using errcode = '23514',
            hint    = 'Solo un lead o admin puede cambiar el asignado.';
  end if;

  -- 1b) Sprint es lead+ solamente — planificación, no ejecución.
  if new.sprint_id is distinct from old.sprint_id then
    raise exception 'Only lead can reassign sprints'
      using errcode = '23514',
            hint    = 'Cambiar el sprint de un ticket es planning — pedile a un lead o al PM.';
  end if;

  -- 1c) Horas estimadas es lead+ solamente — misma razón.
  if new.estimated_hours is distinct from old.estimated_hours then
    raise exception 'Only lead can estimate hours'
      using errcode = '23514',
            hint    = 'La estimación es responsabilidad de la planificación del sprint.';
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

-- El trigger tickets_enforce_contributor_scope ya existe (de 015 T1.12);
-- llama a esta función por nombre y no hace falta recrearlo.

-- 8. RPC del cierre transaccional ─────────────────────────────
-- Firma el reporte (snapshot ANTES del rollover), rollea tickets pendientes
-- al próximo sprint (si hay), cierra el sprint. Todo en una transacción.
--
-- Security definer: el rollover tiene que poder actualizar tickets de
-- contributors ajenos sin disparar el trigger de contributor-scope (que
-- retorna temprano cuando auth.uid() es null; el `security definer` no
-- setea auth.uid, así que el trigger lo saltea). El handler que llama a
-- esta función YA validó que quien inicia el cierre es el PM primario, así
-- que no hay riesgo de que un contributor la invoque.
create or replace function public.close_sprint_with_rollover(
  p_sprint_id      uuid,
  p_next_sprint_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sprint     public.sprints%rowtype;
  v_next       public.sprints%rowtype;
  v_report     jsonb;
  v_rolled_over int;
begin
  -- Validaciones defensivas (el handler ya chequeó, pero el RPC no puede
  -- confiar en su llamador).
  select * into v_sprint from public.sprints where id = p_sprint_id;
  if not found then
    raise exception 'Sprint % not found', p_sprint_id using errcode = '23503';
  end if;
  if v_sprint.status <> 'active' then
    raise exception 'Sprint is not active' using errcode = '23514';
  end if;

  if p_next_sprint_id is not null then
    select * into v_next from public.sprints where id = p_next_sprint_id;
    if not found then
      raise exception 'Next sprint % not found', p_next_sprint_id
        using errcode = '23503';
    end if;
    if v_next.project_id <> v_sprint.project_id then
      raise exception 'Next sprint belongs to a different project'
        using errcode = '23514';
    end if;
    if v_next.status = 'completed' then
      raise exception 'Next sprint is already completed'
        using errcode = '23514';
    end if;
  end if;

  -- Snapshot ANTES del rollover — captura todos los tickets con su status
  -- actual, incluidos los pendientes que van a mudarse.
  select jsonb_build_object(
    'closed_at', to_jsonb(now()),
    'starts_at', to_jsonb(v_sprint.starts_at),
    'ends_at',   to_jsonb(v_sprint.ends_at),
    'tickets', jsonb_build_object(
      'total_at_close', coalesce((
        select count(*)::int from public.tickets where sprint_id = p_sprint_id
      ), 0),
      'completed', coalesce((
        select count(*)::int from public.tickets
        where sprint_id = p_sprint_id
          and status in ('done', 'cancelled')
      ), 0),
      'rolled_over', coalesce((
        select count(*)::int from public.tickets
        where sprint_id = p_sprint_id
          and status not in ('done', 'cancelled')
      ), 0)
    ),
    'hours', jsonb_build_object(
      'estimated_total', coalesce((
        select sum(estimated_hours) from public.tickets where sprint_id = p_sprint_id
      ), 0),
      'estimated_completed', coalesce((
        select sum(estimated_hours) from public.tickets
        where sprint_id = p_sprint_id
          and status in ('done', 'cancelled')
      ), 0),
      'unestimated_count', coalesce((
        select count(*)::int from public.tickets
        where sprint_id = p_sprint_id
          and estimated_hours is null
      ), 0)
    ),
    'by_assignee', coalesce((
      select jsonb_agg(row_obj order by tickets_completed desc, name)
      from (
        select
          jsonb_build_object(
            'user_id', t.assignee_id,
            'name', coalesce(p.full_name, p.email, 'Sin asignar'),
            'tickets_completed', count(*) filter (where t.status in ('done','cancelled')),
            'hours_completed',
              coalesce(sum(t.estimated_hours) filter (where t.status in ('done','cancelled')), 0)
          ) as row_obj,
          count(*) filter (where t.status in ('done','cancelled')) as tickets_completed,
          coalesce(p.full_name, p.email, 'Sin asignar') as name
        from public.tickets t
        left join public.profiles p on p.id = t.assignee_id
        where t.sprint_id = p_sprint_id
        group by t.assignee_id, p.full_name, p.email
      ) grouped
    ), '[]'::jsonb),
    -- Lista de tickets con su status AL MOMENTO DEL CIERRE — la vista de
    -- reporte lee de acá, no del ticket actual (R-2 del spec: el snapshot es
    -- inmutable, cambios post-cierre no lo afectan).
    'tickets_snapshot', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'numero', numero,
        'title', title,
        'status', status,
        'priority', priority,
        'assignee_id', assignee_id,
        'estimated_hours', estimated_hours
      ) order by numero)
      from public.tickets
      where sprint_id = p_sprint_id
    ), '[]'::jsonb),
    'rolled_over_to_sprint_id', to_jsonb(p_next_sprint_id)
  ) into v_report;

  -- Rollover: tickets no completados pasan al próximo sprint (o al backlog
  -- si p_next_sprint_id es null).
  update public.tickets
     set sprint_id = p_next_sprint_id
   where sprint_id = p_sprint_id
     and status not in ('done', 'cancelled');

  get diagnostics v_rolled_over = row_count;

  -- Cierre. El check constraint garantiza que closed_at + report se setean
  -- junto con status; el trigger de status transitions verifica ambos.
  update public.sprints
     set status    = 'completed',
         closed_at = now(),
         report    = v_report
   where id = p_sprint_id;

  return jsonb_build_object(
    'rolled_over', v_rolled_over,
    'report', v_report
  );
end;
$$;

revoke all on function public.close_sprint_with_rollover(uuid, uuid) from public;
grant execute on function public.close_sprint_with_rollover(uuid, uuid) to authenticated;

-- 9. Grants y policies ────────────────────────────────────────
grant select, insert, update on public.sprints to authenticated;
-- Sin delete: el cierre es el equivalente terminal (D-7 patrón de tickets).

create policy "sprints: read for project members"
  on public.sprints for select to authenticated
  using (public.can_view_project(project_id));

create policy "sprints: admin/PM insert"
  on public.sprints for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    or public.is_pm_of_project(project_id)
  );

-- La policy de update deja pasar a admin y PM. La distinción "solo PM primario
-- cierra" NO vive en la RLS — vive en el handler POST /api/sprints/:id/close.
-- Rationale: la RLS es una regla estructural (quién puede tocar la tabla);
-- "quién puede firmar el reporte" es una regla de producto.
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
