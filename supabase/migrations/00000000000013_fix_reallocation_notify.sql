-- Feature: 010-notifications-and-audit
-- Purpose: repara reallocate_booking(), que la migration 11 dejó rota.
--
-- **Esto fue un bug de verdad y estuvo aplicado sobre la base viva.** La sección
-- que agrega los avisos del desplazamiento se generó con un script, y el shell
-- se comió las comillas simples de los literales: `'booking_displaced'` quedó
-- como `booking_displaced`, o sea como una referencia a una columna inexistente.
--
-- Por qué no explotó al aplicarla: plpgsql no valida las referencias del cuerpo
-- al crear la función, solo al ejecutarla. La migration entró limpia y la
-- realocación quedó rota hasta la primera llamada, que devolvía 42703 —
-- `column "booking_displaced" does not exist`. Lo encontró CI, que es donde
-- tenía que encontrarse.
--
-- La lección, para la próxima: **no generar SQL con comillas simples desde un
-- `node -e '...'` adentro de bash.** El literal se pierde en silencio y el
-- resultado sigue siendo SQL válido, que es la peor combinación posible.

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
    'booking_displaced',
    b.id,
    jsonb_build_object(
      'project', p.name,
      'starts_at', b.starts_at,
      'ends_at', b.ends_at,
      'displaced_by_project', (select name from public.projects where id = target_project),
      'displaced_by_booking', created.id
    )
  )
  from public.bookings b
  join public.projects p on p.id = b.project_id
  where b.id = any(found_ids);

  perform public.notify_user(
    b.dev_id,
    'booking_displaced',
    b.id,
    jsonb_build_object(
      'project', p.name,
      'starts_at', b.starts_at,
      'ends_at', b.ends_at,
      'displaced_by_project', (select name from public.projects where id = target_project),
      'displaced_by_booking', created.id
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
