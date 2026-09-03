-- Feature: 006-priority-reallocation
-- Purpose: reallocate_booking() — a priority project takes a slot already held
--          by a common one, atomically, inside one security definer function.
--
-- READ plan.md §3.2 BEFORE TOUCHING THIS FILE. The default failure mode of this
-- feature is silent: the PM doing the displacing is *not* the PM of the booking
-- being displaced, so `bookings: manager update` filters that row out, and an
-- update filtered by RLS does not fail — it affects zero rows, without error.
-- The result would be two overlapping approved bookings, the one thing the
-- functional spec §12 calls non-negotiable, with nothing in the logs. That is
-- R-1, and it is why this is a definer function and not a policy.
--
-- No schema changes: `bookings.status` already accepts 'displaced' (004) and
-- priority is read by joining projects (003/plan.md §3.2).

-- ─────────────────────────────────────────────────────────────
-- 1. Error codes
-- ─────────────────────────────────────────────────────────────
-- The API has to tell these apart to answer AC-1.2 and AC-1.3 with different
-- messages ("you can't" vs. "talk to the other PM" — plan.md §4), and matching
-- on message text is how that breaks the first time someone rewrites the copy.
-- So each refusal carries its own SQLSTATE:
--
--   42501   the caller does not manage the new project     → 403
--   DC001   the new project is not a priority one          → 409
--   DC002   both projects are priority: a tie, resolved    → 409
--           by the PMs (AC-1.3), never automatically
--   DC003   what is in the slot now is not what the PM     → 409
--           confirmed displacing
--   DC004   project or developer invalid / inactive        → 400
--
-- Custom SQLSTATEs are opaque to PostgREST, so it may answer HTTP 500 for them.
-- That is fine and expected: the route handler translates by `error.code`, from
-- the JSON body, never by the HTTP status it arrived with.

-- ─────────────────────────────────────────────────────────────
-- 2. reallocate_booking()
-- ─────────────────────────────────────────────────────────────
-- `security definer` and not the service_role key from the handler: CLAUDE.md
-- forbids that key outside one-off scripts, and with reason — from a route
-- handler it would switch RLS off for everything that request touches. A
-- definer function switches it off inside its own body only, and imposes its
-- own rules there.
--
-- `confirmed_displacing` is not in the signature plan.md §3.3 sketched, and the
-- reason it is here is the one from 005: the plan asks (§4) that a booking
-- which was not confirmed be refused *at write time*. Checked in the handler it
-- would leave the same window `expectedUpdatedAt` was written to close — the PM
-- confirms displacing X, someone approves Y in that slot, and Y gets displaced
-- without anyone ever having seen it. Inside the function there is no window.
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
      and role = 'developer'
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

comment on function public.reallocate_booking(uuid, uuid, timestamptz, timestamptz, uuid[], text, text) is
  'Creates a booking for a priority project over the approved bookings of common projects in the same slot, marking those displaced. Atomic, and it refuses unless every booking it is about to displace was named in confirmed_displacing. See 006/plan.md §3.3.';

-- A definer function without the revoke is an open door: `public` includes
-- every role, so `anon` would hold execute on it too.
revoke all on function public.reallocate_booking(uuid, uuid, timestamptz, timestamptz, uuid[], text, text) from public;
grant execute on function public.reallocate_booking(uuid, uuid, timestamptz, timestamptz, uuid[], text, text) to authenticated;
