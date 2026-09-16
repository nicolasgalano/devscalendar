-- ─────────────────────────────────────────────────────────────
-- 016 · Time tracking
-- ─────────────────────────────────────────────────────────────
-- Reemplazo de TrackingTime. Time entries contra tickets o directamente contra
-- proyecto + actividad (para reuniones, coordinación). Cronómetro persistido
-- en DB para sobrevivir al cierre del navegador. Nuevo rol `staff` para gente
-- de administración/comercial que carga horas sin ser dev.
--
-- Sin plata, sin moneda, sin cupos, sin ausencias. Ver spec.md §5 para lo que
-- queda explícitamente fuera.
--
-- **Primera vez que la app expone DELETE a `authenticated`** (para
-- time_entries y active_timers). Justificación: una entry con horas
-- equivocadas no es historia útil, es un error; un timer detenido tampoco.
-- El audit_log conserva el snapshot pre-borrado para restaurar si hace falta.
--
-- Two-phase safe: todo aditivo. El deploy previo no conoce las tablas ni el
-- valor de enum nuevos y sigue funcionando.
-- ─────────────────────────────────────────────────────────────

-- 1. Rol `staff` ──────────────────────────────────────────────
-- Postgres 15 permite agregar valores a un enum sin rewrite. En Postgres
-- ≥ 12 esto es constante-time y no bloquea; el volumen actual (~20 profiles)
-- lo hace trivial de todas formas.
alter type public.user_role add value if not exists 'staff';

-- 2. Tabla project_activities ─────────────────────────────────
-- Actividades del proyecto — texto libre, definidas por el PM. Sirven para
-- cortar reportes por tipo de trabajo (QA, Desarrollo, PM, Data Entry, etc).
create table public.project_activities (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete restrict,
  name        text not null check (char_length(name) between 1 and 60),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Unique parcial: dos actividades activas del mismo proyecto no comparten
-- nombre (case-insensitive). Reciclar un nombre desactivado sí se permite —
-- si borrás "QA" y meses después la reactivás, no hay que renombrarla.
create unique index project_activities_name_active_idx
  on public.project_activities (project_id, lower(name))
  where active = true;

create index project_activities_project_idx
  on public.project_activities (project_id);

-- 3. Tabla time_entries ───────────────────────────────────────
-- Una carga de horas. Cada fila apunta a un proyecto (siempre) y opcionalmente
-- a un ticket + actividad. La duración se guarda en `minutes` con un check
-- constraint que garantiza múltiplos de 15 min — la disciplina se hace
-- estructural, no cultural.
--
-- `on delete restrict` en `user_id`: un profile con entries no se puede
--   borrar (mismo patrón que 015 con FKs "duras").
-- `on delete set null` en `created_by`: si el admin que cargó por otro se
--   borra (raro), la entry sobrevive apuntando a `null` como creador.
-- `on delete restrict` en `project_id`: los proyectos no se borran en la
--   app (se desactivan). Restrict lo hace explícito.
-- `on delete set null` en `ticket_id` y `activity_id`: la entry sobrevive
--   apuntando a un ticket/actividad "fantasma" — mejor que perder la carga.
create table public.time_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete restrict,
  created_by   uuid references public.profiles(id) on delete set null,
  project_id   uuid not null references public.projects(id) on delete restrict,
  ticket_id    uuid references public.tickets(id) on delete set null,
  activity_id  uuid references public.project_activities(id) on delete set null,
  minutes      int  not null,
  logged_at    date not null,
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint time_entries_minutes_multiple_15
    check (minutes > 0 and minutes <= 960 and minutes % 15 = 0),
  constraint time_entries_description_length
    check (description is null or char_length(description) <= 500)
);

create index time_entries_user_date_idx
  on public.time_entries (user_id, logged_at desc);
create index time_entries_project_date_idx
  on public.time_entries (project_id, logged_at desc);
create index time_entries_ticket_idx
  on public.time_entries (ticket_id) where ticket_id is not null;
create index time_entries_activity_idx
  on public.time_entries (activity_id) where activity_id is not null;

-- 4. Tabla active_timers ──────────────────────────────────────
-- Estado del cronómetro. UNA fila por user (PK) — garantía dura que un mismo
-- usuario no puede tener dos timers corriendo. Arrancar con otro corriendo
-- pisa la fila después de persistir el anterior como time_entry (RPC).
create table public.active_timers (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete restrict,
  ticket_id    uuid references public.tickets(id) on delete set null,
  activity_id  uuid references public.project_activities(id) on delete set null,
  started_at   timestamptz not null default now()
);

-- 5. Extensión de notifications ───────────────────────────────
-- Recrear el check constraint con los dos tipos nuevos, y sumar columna
-- `time_entry_id` nullable — mismo patrón que 015 sumó `ticket_id`.
alter table public.notifications
  add column time_entry_id uuid references public.time_entries(id) on delete cascade;

do $$
declare
  ctname text;
begin
  select conname into ctname
  from pg_constraint
  where conrelid = 'public.notifications'::regclass
    and contype = 'c'
    and conname like 'notifications_type%';
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
    'ticket_status_changed',
    'time_entry_created_by_other',
    'time_entry_deleted_by_admin'
  ));

-- 6. Trigger de touch ────────────────────────────────────────
create or replace function public.touch_time_entry_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger time_entries_touch_updated_at
  before update on public.time_entries
  for each row execute function public.touch_time_entry_updated_at();

-- 7. Audit ────────────────────────────────────────────────────
-- Un solo trigger que cubre insert/update/delete. Para delete guarda el
-- payload pre-borrado completo — es el mecanismo para "restaurar" una entry
-- borrada (leer del audit_log y reinsertarla manualmente).
create or replace function public.audit_time_entry_events()
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
    values ('time_entry', new.id, 'create', actor_id, to_jsonb(new));
    return null;
  end if;

  if tg_op = 'UPDATE' then
    -- Diff genérico sobre las columnas que pueden cambiar.
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values ('time_entry', new.id, 'update', actor_id, jsonb_build_object(
      'old', to_jsonb(old) - array['created_at','updated_at']::text[],
      'new', to_jsonb(new) - array['created_at','updated_at']::text[]
    ));
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values ('time_entry', old.id, 'delete', actor_id, jsonb_build_object(
      'deleted_row', to_jsonb(old)
    ));
    return null;
  end if;

  return null;
end;
$$;

revoke all on function public.audit_time_entry_events() from public;

create trigger time_entries_audit
  after insert or update or delete on public.time_entries
  for each row execute function public.audit_time_entry_events();

-- 8. Notify (patrón 010 / ADR 0012) ──────────────────────────
-- Helper paralelo a notify_user / notify_user_for_ticket. Mantiene la
-- invariante "no me avises de lo mío" en un solo lugar.
create or replace function public.notify_user_for_time_entry(
  target_recipient     uuid,
  notification_type    text,
  target_time_entry    uuid,
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

  insert into public.notifications (recipient_id, time_entry_id, type, payload)
  values (target_recipient, target_time_entry, notification_type, notification_payload);
end;
$$;

revoke all on function public.notify_user_for_time_entry(uuid, text, uuid, jsonb) from public;

-- Trigger de notify — dispara `time_entry_created_by_other` cuando el
-- created_by es distinto del user_id.
create or replace function public.notify_time_entry_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_key   text;
  v_project_name text;
begin
  if tg_op = 'INSERT' then
    if new.created_by is not null and new.created_by <> new.user_id then
      -- Alguien cargó por otro. Avisamos al user_id.
      select projects.name into v_project_name
      from public.projects where id = new.project_id;

      perform public.notify_user_for_time_entry(
        new.user_id,
        'time_entry_created_by_other',
        new.id,
        jsonb_build_object(
          'created_by', new.created_by,
          'project_id', new.project_id,
          'project', v_project_name,
          'ticket_id', new.ticket_id,
          'minutes', new.minutes,
          'logged_at', new.logged_at
        )
      );
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    -- Si el actor es admin y no el propio user, avisar. is_admin() ya folds
    -- `active`; auth.uid() puede ser null en service_role (no notifica).
    if auth.uid() is not null
       and auth.uid() <> old.user_id
       and public.is_admin(auth.uid()) then
      select projects.name into v_project_name
      from public.projects where id = old.project_id;

      -- No podemos referenciar `time_entry_id` del target — la entry se está
      -- borrando en esta misma transacción, y el FK con `on delete cascade`
      -- borraría la notificación en cuanto se commitee. Pasamos null.
      perform public.notify_user_for_time_entry(
        old.user_id,
        'time_entry_deleted_by_admin',
        null,
        jsonb_build_object(
          'deleted_by', auth.uid(),
          'project_id', old.project_id,
          'project', v_project_name,
          'ticket_id', old.ticket_id,
          'minutes', old.minutes,
          'logged_at', old.logged_at,
          'description', old.description
        )
      );
    end if;
    return null;
  end if;

  return null;
end;
$$;

revoke all on function public.notify_time_entry_events() from public;

create trigger time_entries_notify
  after insert or delete on public.time_entries
  for each row execute function public.notify_time_entry_events();

-- 9. Audit de project_activities ─────────────────────────────
create or replace function public.audit_project_activity_events()
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
    values ('project_activity', new.id, 'create', actor_id, to_jsonb(new));
    return null;
  end if;

  if tg_op = 'UPDATE' then
    if new.active is distinct from old.active then
      insert into public.audit_log (entity, entity_id, action, actor_id, diff)
      values (
        'project_activity', new.id,
        case when new.active then 'reactivated' else 'deactivated' end,
        actor_id,
        jsonb_build_object('name', new.name)
      );
    end if;
    if new.name is distinct from old.name then
      insert into public.audit_log (entity, entity_id, action, actor_id, diff)
      values ('project_activity', new.id, 'rename', actor_id, jsonb_build_object(
        'from', old.name, 'to', new.name
      ));
    end if;
    return null;
  end if;

  return null;
end;
$$;

revoke all on function public.audit_project_activity_events() from public;

create trigger project_activities_audit
  after insert or update on public.project_activities
  for each row execute function public.audit_project_activity_events();

-- 10. RPC stop_timer ──────────────────────────────────────────
-- Para el timer del usuario, calcula minutos (redondeados a múltiplo de 15,
-- mínimo 15), inserta una time_entry y borra la fila de active_timers.
-- Atómico. Devuelve el id de la entry creada, o null si no había timer.
--
-- security definer: la RLS de active_timers exige `user_id = auth.uid()`, y
-- la de time_entries exige contributor+ del proyecto — la función se llama
-- desde el handler que YA validó auth.uid(). Adentro no hay filtro por
-- auth.uid() porque el parámetro `p_user_id` es la verdad — el handler pasa
-- `auth.uid()` explícitamente.
create or replace function public.stop_timer(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timer  public.active_timers%rowtype;
  v_minutes int;
  v_entry_id uuid;
  v_logged_at date;
begin
  select * into v_timer from public.active_timers where user_id = p_user_id;
  if not found then return null; end if;

  -- Redondeo a múltiplo de 15, con mínimo 15.
  v_minutes := greatest(
    15,
    (extract(epoch from (now() - v_timer.started_at)) / 60 / 15)::int * 15
  );

  -- La fecha del entry es la del día local en que se PARÓ, no cuando arrancó.
  -- Un timer que arranca a las 22:00 y se para a las 01:00 crea una entry con
  -- fecha del día siguiente. Es lo intuitivo para el usuario.
  v_logged_at := (now() at time zone 'America/Argentina/Buenos_Aires')::date;

  insert into public.time_entries (
    user_id, created_by, project_id, ticket_id, activity_id,
    minutes, logged_at, description
  )
  values (
    p_user_id, p_user_id, v_timer.project_id, v_timer.ticket_id, v_timer.activity_id,
    v_minutes, v_logged_at, null
  )
  returning id into v_entry_id;

  delete from public.active_timers where user_id = p_user_id;

  return v_entry_id;
end;
$$;

revoke all on function public.stop_timer(uuid) from public;
grant execute on function public.stop_timer(uuid) to authenticated;

-- 11. RPC stop_and_start_timer ────────────────────────────────
-- Para el timer actual (si hay) y arranca uno nuevo. Devuelve el id del
-- entry stopped (o null) y el started_at del nuevo timer.
create or replace function public.stop_and_start_timer(
  p_user_id uuid,
  p_project_id uuid,
  p_ticket_id uuid,
  p_activity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stopped_entry_id uuid;
  v_started_at timestamptz;
begin
  v_stopped_entry_id := public.stop_timer(p_user_id);

  insert into public.active_timers (user_id, project_id, ticket_id, activity_id)
  values (p_user_id, p_project_id, p_ticket_id, p_activity_id)
  returning started_at into v_started_at;

  return jsonb_build_object(
    'stopped_entry_id', v_stopped_entry_id,
    'started_at', v_started_at
  );
end;
$$;

revoke all on function public.stop_and_start_timer(uuid, uuid, uuid, uuid) from public;
grant execute on function public.stop_and_start_timer(uuid, uuid, uuid, uuid) to authenticated;

-- 12. Grants ──────────────────────────────────────────────────
-- **Primera vez con DELETE en authenticated**: time_entries y active_timers.
-- Documentado en el header de la migration.
grant select, insert, update, delete on public.time_entries to authenticated;
grant select, insert, delete on public.active_timers to authenticated;
grant select, insert, update on public.project_activities to authenticated;
-- Sin delete para project_activities: se desactivan con `active = false`.

-- 13. Policies — time_entries ─────────────────────────────────
create policy "time_entries: read for project members"
  on public.time_entries for select to authenticated
  using (public.can_view_project(project_id));

-- Insert: dos policies alternativas (OR entre ellas).
-- (a) El user carga para sí mismo, siendo contributor+ del proyecto.
create policy "time_entries: insert as self"
  on public.time_entries for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      public.is_admin(auth.uid())
      or public.is_pm_of_project(project_id)
      or public.role_in_project(project_id, auth.uid()) in ('contributor', 'lead')
    )
  );

-- (b) Admin, PM del proyecto o `lead` cargan por otra persona.
create policy "time_entries: insert for others"
  on public.time_entries for insert to authenticated
  with check (
    user_id <> auth.uid()
    and (
      public.is_admin(auth.uid())
      or public.is_pm_of_project(project_id)
      or public.role_in_project(project_id, auth.uid()) = 'lead'
    )
  );

-- Update/delete: propia o admin. La ventana de 7 días se enforce en el
-- handler (la RLS no puede expresar "logged_at >= current_date - 7").
create policy "time_entries: update own or admin"
  on public.time_entries for update to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

create policy "time_entries: delete own or admin"
  on public.time_entries for delete to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- 14. Policies — active_timers ────────────────────────────────
-- Solo el dueño ve y toca su timer. Admin no ve timers ajenos — no hay caso.
create policy "active_timers: only own"
  on public.active_timers for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 15. Policies — project_activities ───────────────────────────
create policy "project_activities: read for project members"
  on public.project_activities for select to authenticated
  using (public.can_view_project(project_id));

create policy "project_activities: admin/pm insert"
  on public.project_activities for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    or public.is_pm_of_project(project_id)
  );

create policy "project_activities: admin/pm update"
  on public.project_activities for update to authenticated
  using (
    public.is_admin(auth.uid())
    or public.is_pm_of_project(project_id)
  )
  with check (
    public.is_admin(auth.uid())
    or public.is_pm_of_project(project_id)
  );
