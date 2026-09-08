-- Feature: 010-notifications-and-audit
-- Purpose: the notifications outbox, the trigger that fills it, and the two
--          audit_log actions that were missing.
--
-- READ specs/features/010-notifications-and-audit/plan.md §2 BEFORE EDITING.
-- The design turns on ONE line: the notification row is written by a trigger,
-- inside the same transaction as the event. If the booking exists, the notice
-- exists. Sending the email is on the other side of that line and may fail as
-- often as it likes — nobody loses a booking or a notice, delivery is just late.
--
-- The other thing worth not getting wrong: this trigger runs INSIDE the booking
-- write. If it throws, the booking fails — not the notification. So it resolves
-- a recipient and inserts, and nothing else.
--
-- Purely additive: new table, new functions, one new trigger, nothing dropped.
-- That is what makes it safe to apply to a database that now holds real people
-- (CLAUDE.md §Migrations, the two-phase rule — this one needs no second phase).

-- ─────────────────────────────────────────────────────────────
-- 1. notifications
-- ─────────────────────────────────────────────────────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  -- `on delete cascade` on BOTH FKs, and it is a deliberate departure from the
  -- project convention (CLAUDE.md §Migrations: soft ref → set null, hard ref →
  -- restrict). A notification is not history, it is a message: without its
  -- recipient it means nothing, and without its booking it has nowhere to lead.
  -- The history lives in audit_log, which is exactly why THAT table keeps
  -- `set null` and survives the actor being removed.
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  type text not null check (type in (
    'booking_created',
    'booking_approved',
    'booking_rejected',
    'booking_cancelled',
    'booking_needs_reapproval',
    'booking_displaced'
  )),
  -- Frozen at write time on purpose: a notice has to be able to say "they took
  -- your Tuesday slot on Project X" even after the booking changes again.
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  email_status text not null default 'pending'
    check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  email_attempts int not null default 0,
  email_error text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- La bandeja lee "lo mío, lo no leído primero"; el dispatch lee "lo pendiente,
-- lo más viejo primero". Un índice para cada una.
create index notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);
create index notifications_pending_idx
  on public.notifications (created_at)
  where email_status = 'pending';

alter table public.notifications enable row level security;

-- Sin `insert` ni `update` para `authenticated`: las filas las escriben los
-- triggers `security definer` y nadie más, y marcar leído va por la función de
-- la sección 4. Una policy sin grant deniega en silencio (el bug de 001), así
-- que lo que no está acá es deliberado.
grant select on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- **El select NO pasa por has_role().** Alguien desactivado tiene que poder leer
-- lo que ya le llegó: el chequeo de `active` corta lo que podés *hacer*, no lo
-- que te pasó. Mismo criterio que `profiles: self read` en 012.
create policy "notifications: recipient read"
  on public.notifications for select
  to authenticated
  using (recipient_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 2. notify_user(): el único lugar donde vive "no me avises de lo mío"
-- ─────────────────────────────────────────────────────────────
-- AC-1.6. Con roles múltiples (012) un PM puede ser el desarrollador de su
-- propia reserva, así que este caso dejó de ser raro: avisarle a alguien de lo
-- que acaba de hacer es ruido, y el ruido enseña a ignorar la bandeja.
--
-- Con `service_role` —seeds y fixtures— `auth.uid()` es null y no filtra nada,
-- que es lo que esos caminos necesitan para poder sembrar estados.
create or replace function public.notify_user(
  target_recipient uuid,
  notification_type text,
  target_booking uuid,
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

  insert into public.notifications (recipient_id, booking_id, type, payload)
  values (target_recipient, target_booking, notification_type, notification_payload);
end;
$$;

revoke all on function public.notify_user(uuid, text, uuid, jsonb) from public;

-- ─────────────────────────────────────────────────────────────
-- 3. El trigger que llena la bandeja y completa la auditoría
-- ─────────────────────────────────────────────────────────────
-- `after`, no `before`: para cuando corre, la fila ya está escrita y su id es
-- definitivo. Y `after` no puede alterar lo que se guardó, que es justo lo que
-- se quiere de algo que solo observa.
--
-- **`displaced` NO se maneja acá y es a propósito.** `reallocate_booking()`
-- marca la vieja como desplazada *antes* de insertar la nueva, así que en este
-- punto la reserva que se llevó la franja todavía no existe y el aviso no podría
-- nombrarla — que es exactamente lo que AC-1.5 pide. Lo escribe esa función, en
-- la sección 5, cuando ya tiene las dos en la mano.
create or replace function public.notify_booking_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_name text;
  project_pm uuid;
  base_payload jsonb;
begin
  select p.name, p.pm_id into project_name, project_pm
  from public.projects p
  where p.id = new.project_id;

  base_payload := jsonb_build_object(
    'project', project_name,
    'starts_at', new.starts_at,
    'ends_at', new.ends_at
  );

  if tg_op = 'INSERT' then
    -- Auditoría: `create`, que hasta 010 no se registraba. Una reserva creada no
    -- dejaba rastro salvo que después cambiara de estado.
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values ('booking', new.id, 'create', auth.uid(), jsonb_build_object(
      'project', new.project_id,
      'dev', new.dev_id,
      'starts_at', new.starts_at,
      'ends_at', new.ends_at,
      'status', new.status
    ));

    perform public.notify_user(new.dev_id, 'booking_created', new.id, base_payload);
    return null;
  end if;

  -- ── UPDATE ───────────────────────────────────────────────────────────────
  -- Auditoría: `update`. El cambio de estado ya tiene su propia fila desde 005
  -- (`status_change`), así que acá se registra lo otro — y solo si cambió algo,
  -- para no ensuciar el log con updates que no movieron nada.
  if new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.dev_id is distinct from old.dev_id
     or new.note is distinct from old.note
     or new.ticket_ref is distinct from old.ticket_ref then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values ('booking', new.id, 'update', auth.uid(), jsonb_build_object(
      'from', jsonb_build_object(
        'dev', old.dev_id, 'starts_at', old.starts_at, 'ends_at', old.ends_at,
        'note', old.note, 'ticket_ref', old.ticket_ref
      ),
      'to', jsonb_build_object(
        'dev', new.dev_id, 'starts_at', new.starts_at, 'ends_at', new.ends_at,
        'note', new.note, 'ticket_ref', new.ticket_ref
      )
    ));
  end if;

  if new.status is distinct from old.status then
    if new.status = 'approved' then
      perform public.notify_user(project_pm, 'booking_approved', new.id, base_payload);

    elsif new.status = 'rejected' then
      -- El comentario viaja en el aviso: un rechazo sin motivo obliga a entrar a
      -- buscarlo, que es justo lo que esto viene a evitar (AC-1.2).
      perform public.notify_user(project_pm, 'booking_rejected', new.id,
        base_payload || jsonb_build_object('response_note', new.response_note));

    elsif new.status = 'cancelled' then
      perform public.notify_user(new.dev_id, 'booking_cancelled', new.id, base_payload);

    elsif new.status = 'pending' and old.status = 'approved' then
      -- Q-E: mover horario o desarrollador devuelve la reserva a pending. Lo que
      -- el dev había aprobado cambió, así que se entera.
      perform public.notify_user(new.dev_id, 'booking_needs_reapproval', new.id, base_payload);
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.notify_booking_event() from public;

create trigger bookings_notify
  after insert or update on public.bookings
  for each row execute function public.notify_booking_event();

-- ─────────────────────────────────────────────────────────────
-- 4. Marcar leído
-- ─────────────────────────────────────────────────────────────
-- Una función y no una policy de `update`, y vale decir por qué: es el problema
-- de ADR 0009 —la RLS no sabe expresar "solo esta columna", porque `using` mira
-- la fila vieja y `with check` la nueva y ninguna las compara—. Allá se resolvió
-- con un guard adentro de un trigger porque había reglas de negocio sobre lo que
-- el dev escribe. Acá no hay ninguna regla más allá de "es mía", así que no dar
-- el grant y exponer una función chica es menos maquinaria que una policy más un
-- trigger que la corrija.
create or replace function public.mark_notifications_read(ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.notifications
  set read_at = now()
  where id = any(ids)
    and recipient_id = auth.uid()
    and read_at is null;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. reallocate_booking(): los avisos del desplazamiento
-- ─────────────────────────────────────────────────────────────
-- El cuerpo es el de la migration 09 con la sección 7 agregada al final;
-- Postgres no tiene reemplazo parcial, así que se reproduce entero. Fue generado
-- desde ese archivo con la inserción aplicada, no retipeado.
create or replace function public.reallocate_booking(
  target_project uuid,
  target_dev uuid,
  starts timestamptz,
  ends timestamptz,
  confirmed_displacing uuid[],
  booking_note text default null,
  ticket text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_priority text;
  found_ids uuid[];
  confirmed_ids uuid[];
  blocker record;
  created public.bookings%rowtype;
  displaced_rows jsonb;
begin
  -- ── 1. The caller manages the project the new booking is for ─────────────
  -- Without this the definer function is an open door: anyone authenticated
  -- could book time on any project, which is precisely what the RLS it bypasses
  -- exists to prevent.
  if not public.can_manage_booking(target_project) then
    raise exception 'Solo el PM del proyecto o un admin puede reservar en su nombre'
      using errcode = '42501';
  end if;

  select p.priority into new_priority
  from public.projects p
  where p.id = target_project
    and p.active;

  if new_priority is null then
    raise exception 'El proyecto no existe o está desactivado'
      using errcode = 'DC004';
  end if;

  -- ── 2. The developer exists, is active, and is a developer ───────────────
  -- Same criterion as the plain create path (004): Postgres cannot require a FK
  -- to point at a profile with a given role, so it is checked here. In this
  -- function it has to be checked *here* and not only in the handler, or a
  -- definer function would happily book time for a deactivated account.
  if not exists (
    select 1
    from public.profiles
    where id = target_dev
      and active
      and 'developer' = any(roles)
  ) then
    raise exception 'El desarrollador no existe o está desactivado'
      using errcode = 'DC004';
  end if;

  -- ── 3. What the developer already holds in that range ────────────────────
  -- The lock is R-4: two priority reallocations landing on the same slot would
  -- otherwise both read "nothing here but a common booking" and both write. One
  -- transaction does not serialise them by itself. Under READ COMMITTED the
  -- second one blocks here, then re-reads the row it waited for and finds it
  -- already 'displaced', so the predicate below no longer returns it.
  --
  -- What this does *not* cover is a booking approved into this range after the
  -- lock: there are no predicate locks without SERIALIZABLE. The consequence is
  -- bounded — what we insert is 'pending', so it cannot double-book anything,
  -- and the exclusion constraint still refuses the overlap when somebody tries
  -- to approve it.
  perform 1
  from public.bookings b
  where b.dev_id = target_dev
    and b.status = 'approved'
    -- The same half-open comparison as the exclusion constraint: tstzrange is
    -- [), so 09:00-13:00 and 13:00-17:00 do not overlap.
    and b.starts_at < ends
    and b.ends_at > starts
  for update;

  select coalesce(array_agg(b.id order by b.id), '{}'::uuid[])
    into found_ids
  from public.bookings b
  where b.dev_id = target_dev
    and b.status = 'approved'
    and b.starts_at < ends
    and b.ends_at > starts;

  -- ── 4. It is what the PM confirmed, and all of it is displaceable ────────
  -- Nothing to displace is not success with an empty list: it would turn this
  -- into a second create path, one that skips the conflict check of the plain
  -- one for no reason. The plain path is right there and it is the one that
  -- knows how to answer.
  if found_ids = '{}'::uuid[] then
    raise exception 'Ya no hay ninguna reserva aprobada en esa franja'
      using errcode = 'DC003';
  end if;

  -- The set comparison comes first on purpose. If the slot changed under the
  -- PM's feet — say a priority booking got approved there while the dialog was
  -- open — the honest answer is "look again", not a tie message about a booking
  -- they never saw.
  select coalesce(array_agg(distinct c order by c), '{}'::uuid[])
    into confirmed_ids
  from unnest(coalesce(confirmed_displacing, '{}'::uuid[])) as t(c);

  if found_ids is distinct from confirmed_ids then
    raise exception 'Lo que ocupa esa franja cambió desde que lo confirmaste'
      using errcode = 'DC003';
  end if;

  -- A common project never displaces anything: neither a priority booking
  -- (AC-1.2) nor another common one, which is the ordinary conflict the plain
  -- create path already answers with its own 409.
  if new_priority is distinct from 'high' then
    select p.name as project_name
      into blocker
    from public.bookings b
    join public.projects p on p.id = b.project_id
    where b.id = any(found_ids)
    order by b.starts_at
    limit 1;

    raise exception 'La franja está ocupada por el proyecto %, y este proyecto no es prioritario',
      blocker.project_name
      using errcode = 'DC001';
  end if;

  -- Two priority projects do not displace each other (AC-1.3). With two levels
  -- the tie cannot resolve itself (R-5), so it goes back to the PMs with a name
  -- to call, and never to an automatic override.
  select p.name as project_name, pm.full_name as pm_name, pm.email as pm_email
    into blocker
  from public.bookings b
  join public.projects p on p.id = b.project_id
  left join public.profiles pm on pm.id = p.pm_id
  where b.id = any(found_ids)
    and p.priority = 'high'
  order by b.starts_at
  limit 1;

  if found then
    raise exception 'La franja está ocupada por %, que también es prioritario. Resolvelo con %',
      blocker.project_name, coalesce(blocker.pm_name, blocker.pm_email, 'su PM')
      using errcode = 'DC002';
  end if;

  -- ── 5. Displace, then create. Both or neither ────────────────────────────
  -- One transaction because the halves are worthless apart: a new booking on
  -- top of an approved one, or a displaced booking with nothing replacing it,
  -- are both worse than having done nothing.
  update public.bookings
     set status = 'displaced'
   where id = any(found_ids);

  insert into public.bookings (
    project_id, dev_id, created_by, starts_at, ends_at, note, ticket_ref, status
  )
  values (
    target_project, target_dev, auth.uid(), starts, ends, booking_note, ticket,
    -- AC-3.1: it is born pending. Displacing settles whose time it is, never
    -- that the developer already agreed to give it (Q-6 default, ADR 0009).
    'pending'
  )
  returning * into created;

  -- ── 6. Why, not just what (plan.md §3.4) ─────────────────────────────────
  -- bookings_log_status_change already logged approved → displaced, but its
  -- diff cannot say what displaced it. This row can. Two rows per displaced
  -- booking on purpose: one counts the state change, the other the decision,
  -- and 010 will want to read them differently.
  insert into public.audit_log (entity, entity_id, action, actor_id, diff)
  select
    'booking',
    b.id,
    'reallocated',
    auth.uid(),
    jsonb_build_object(
      'displaced_by', created.id,
      'project', target_project,
      'actor', auth.uid()
    )
  from public.bookings b
  where b.id = any(found_ids);

  -- ── 7. Los avisos del desplazamiento (010, AC-1.5) ───────────────────────
  -- **Acá y no en el trigger `bookings_notify`, y el motivo es el orden.** El
  -- paso 5 marca la vieja como `displaced` *antes* de insertar la nueva, así
  -- que cuando ese trigger corre la reserva que se llevó la franja todavía no
  -- existe: podría avisar que algo pasó, pero no nombrar al culpable — que es
  -- justo lo que el AC pide. Acá están las dos en la mano.
  --
  -- Dos destinatarios por reserva desplazada: el PM que la había conseguido y
  -- el desarrollador que la tenía comprometida. Es el caso que justifica la
  -- feature entera y el único con más de un interesado.
  perform public.notify_user(
    p.pm_id,
    booking_displaced,
    b.id,
    jsonb_build_object(
      project, p.name,
      starts_at, b.starts_at,
      ends_at, b.ends_at,
      displaced_by_project, (select name from public.projects where id = target_project),
      displaced_by_booking, created.id
    )
  )
  from public.bookings b
  join public.projects p on p.id = b.project_id
  where b.id = any(found_ids);

  perform public.notify_user(
    b.dev_id,
    booking_displaced,
    b.id,
    jsonb_build_object(
      project, p.name,
      starts_at, b.starts_at,
      ends_at, b.ends_at,
      displaced_by_project, (select name from public.projects where id = target_project),
      displaced_by_booking, created.id
    )
  )
  from public.bookings b
  join public.projects p on p.id = b.project_id
  where b.id = any(found_ids);

  select coalesce(jsonb_agg(to_jsonb(b) order by b.starts_at), '[]'::jsonb)
    into displaced_rows
  from public.bookings b
  where b.id = any(found_ids);

  return jsonb_build_object(
    'booking', to_jsonb(created),
    'displaced', displaced_rows
  );
end;
$$;

revoke all on function public.reallocate_booking(uuid, uuid, timestamptz, timestamptz, uuid[], text, text) from public;
grant execute on function public.reallocate_booking(uuid, uuid, timestamptz, timestamptz, uuid[], text, text) to authenticated;
