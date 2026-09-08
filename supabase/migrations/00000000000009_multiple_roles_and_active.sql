-- Feature: 012-multiple-roles-and-active-enforcement
-- Purpose: profiles.role (one value) becomes profiles.roles (a set), and the
--          authorisation path starts honouring profiles.active.
--
-- Settles two registered debts at once, and they travel together for one
-- concrete reason: both rewrite current_user_role(), the door to seven
-- policies. Doing them apart means two migrations over the same function and
-- two rounds of integration tests.
--
--   D-09  one role per person, and there are people who are PM *and* admin.
--         The damage is not about operating bookings (admin already covers pm)
--         but about *belonging*: projects.pm_id demands role = 'pm' exactly, so
--         a PM who is also an admin cannot be named responsible for their own
--         project — and 010 notifies projects.pm_id.
--
--   D-01  active = false was applied by exactly one place in the whole
--         authorisation path: src/app/(app)/layout.tsx, a UI layout. No API
--         route has a layout. A deactivated admin kept creating clients by API,
--         a deactivated PM kept booking, a deactivated dev kept approving.
--
-- READ specs/features/012-.../plan.md §3.3 BEFORE EDITING. Nine policies are
-- recreated here and the list lives there. Postgres refuses to drop a function
-- policies depend on, so a forgotten one fails this migration instead of
-- leaving a silent hole — but that safety net only covers the policies that go
-- through current_user_role(). Two of the nine read profiles.role directly
-- (numbers 8 and 9 in that table) and would have failed later, at runtime.
--
-- DESTRUCTIVE. Drops profiles.role, profile_invites.role and
-- current_user_role(). The backfill runs first, in this same transaction.

-- ─────────────────────────────────────────────────────────────
-- 1. The roles column, backfilled
-- ─────────────────────────────────────────────────────────────
-- An array and not a `profile_roles` junction table: the set is three fixed,
-- global values, and profiles is a row getCurrentProfile() already reads once
-- per request. A junction table would turn every membership question into a
-- join and make every screen that shows roles fetch them separately. See
-- ADR 0011 — and note it is reversible: if roles ever become per-project, the
-- table is the way and this array migrates into it.
alter table public.profiles
  add column roles public.user_role[] not null default '{}';

update public.profiles
set roles = case when role is null then '{}'::public.user_role[] else array[role] end;

alter table public.profile_invites
  add column roles public.user_role[] not null default '{}';

update public.profile_invites set roles = array[role];

-- The invite is useless without at least one role; profiles legitimately sit
-- empty while their owner waits in /pending-access. The default only existed to
-- make the backfill possible on a non-empty table, and it would violate the
-- constraint below, so it goes away with it.
alter table public.profile_invites alter column roles drop default;

alter table public.profile_invites
  add constraint profile_invites_roles_not_empty check (cardinality(roles) > 0);

-- ─────────────────────────────────────────────────────────────
-- 2. Normalise on write: sorted, no duplicates
-- ─────────────────────────────────────────────────────────────
-- "The array has no repeats" is not expressible as a check constraint —
-- constraints cannot carry subqueries — so it is a trigger. Sorting is not
-- cosmetic either: it makes two equal sets store identically, so a test can
-- compare them without depending on the order the checkboxes were ticked in.
create or replace function public.normalise_roles()
returns trigger
language plpgsql
as $$
begin
  new.roles = coalesce(
    (select array_agg(distinct r order by r) from unnest(new.roles) as r),
    '{}'::public.user_role[]
  );
  return new;
end;
$$;

-- No `update of roles` column list: profiles already carries a second before
-- update trigger (profiles_set_updated_at) and the two fire in alphabetical
-- order of their names. Neither depends on the other — but 0007 already warned
-- about resting a rule on that ordering, so this one is written to be
-- order-independent: it only ever rewrites new.roles from new.roles.
create trigger profiles_normalise_roles
  before insert or update on public.profiles
  for each row execute function public.normalise_roles();

create trigger profile_invites_normalise_roles
  before insert or update on public.profile_invites
  for each row execute function public.normalise_roles();

-- ─────────────────────────────────────────────────────────────
-- 3. Membership, replacing "what is your role"
-- ─────────────────────────────────────────────────────────────
-- security definer for the same reason current_user_role() was: reading
-- profiles from inside a policy *on* profiles is recursion.
--
-- `and active` is D-01, and it is the whole point of doing both debts at once:
-- one place decides that a deactivated user is nobody, and seven policies
-- inherit it.
create or replace function public.has_role(target public.user_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active
      and target = any(roles)
  );
$$;

create or replace function public.has_any_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active
      and cardinality(roles) > 0
  );
$$;

revoke all on function public.has_role(public.user_role) from public;
revoke all on function public.has_any_role() from public;
grant execute on function public.has_role(public.user_role) to authenticated;
grant execute on function public.has_any_role() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. The nine policies (plan.md §3.3)
-- ─────────────────────────────────────────────────────────────
-- 1-2. profiles. `profiles: self read` is NOT in this list and that is
-- deliberate: it is auth.uid() = id, goes through no role function, and is what
-- lets /pending-access say something to a deactivated user instead of leaving
-- them bouncing (spec R-4, AC-3.4).
drop policy "profiles: admin read all" on public.profiles;
create policy "profiles: admin read all"
  on public.profiles for select
  to authenticated
  using (public.has_role('admin'));

drop policy "profiles: admin write" on public.profiles;
create policy "profiles: admin write"
  on public.profiles for all
  to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- 3-4. clients and projects.
drop policy "clients: admin write" on public.clients;
create policy "clients: admin write"
  on public.clients for all
  to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

drop policy "projects: admin write" on public.projects;
create policy "projects: admin write"
  on public.projects for all
  to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- 5. invites.
drop policy "profile_invites: admin all" on public.profile_invites;
create policy "profile_invites: admin all"
  on public.profile_invites for all
  to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- 6. audit log.
drop policy "audit_log: admin read" on public.audit_log;
create policy "audit_log: admin read"
  on public.audit_log for select
  to authenticated
  using (public.has_role('admin'));

-- 7. Reading the calendar now also requires being active. A deactivated user
-- ends up in /pending-access anyway; this makes it true below the UI too.
drop policy "bookings: team read" on public.bookings;
create policy "bookings: team read"
  on public.bookings for select
  to authenticated
  using (public.has_any_role());

-- 8. The team directory deliberately does NOT gain `active`. It filters the row
-- being read, not the reader, and the calendar prints the assigned developer's
-- name on every block for every viewer. Filtering by active here would strip
-- the name from the bookings of anyone deactivated — the exact bug migration 05
-- was written to fix. Spec R-5 / AC-3.5.
drop policy "profiles: team directory read" on public.profiles;
create policy "profiles: team directory read"
  on public.profiles for select
  to authenticated
  using (cardinality(roles) > 0);

-- 9. A deactivated developer stops answering their own bookings. The column
-- guard inside enforce_booking_status_transition() is untouched: it is identity
-- (auth.uid() = dev_id) and stays that way — ADR 0009 still holds, an admin is
-- still not a shortcut for approving.
drop policy "bookings: developer responds" on public.bookings;
create policy "bookings: developer responds"
  on public.bookings for update
  to authenticated
  using (dev_id = auth.uid() and public.has_role('developer'))
  with check (dev_id = auth.uid() and public.has_role('developer'));

-- ─────────────────────────────────────────────────────────────
-- 5. Functions that changed content
-- ─────────────────────────────────────────────────────────────
-- can_manage_booking(): the admin branch goes through membership, and the PM
-- branch gains the `active` it never had. Being the pm_id of a project stopped
-- being enough on its own.
create or replace function public.can_manage_booking(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin')
      or exists (
        select 1
        from public.projects p
        join public.profiles me on me.id = auth.uid()
        where p.id = target_project
          and p.pm_id = auth.uid()
          and me.active
      );
$$;

-- handle_new_user(): consumes the invite's whole set. Without an invite the
-- profile is born with an empty set and lands in /pending-access, which is what
-- a null role did before (AC-1.5).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_roles public.user_role[];
begin
  delete from public.profile_invites
  where email = new.email
  returning roles into invited_roles;

  insert into public.profiles (id, email, full_name, avatar_url, roles)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(invited_roles, '{}'::public.user_role[])
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- reallocate_booking(): the only thing that changed is the developer check —
-- `role = 'developer'` became `'developer' = any(roles)`. The two `active`
-- checks it already had stay exactly as they were: this was the one path in the
-- codebase that got D-01 right, and it is the evidence that D-01 was an
-- oversight and not a decision.
--
-- The body below is the one from migration 08, reproduced because Postgres has
-- no partial replace. It was generated from that file with the single
-- substitution applied, not retyped.
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

-- ─────────────────────────────────────────────────────────────
-- 6. Drop the old world
-- ─────────────────────────────────────────────────────────────
-- Nothing depends on current_user_role() any more. If this line fails, a policy
-- was missed in section 4 — which is the safety net described at the top of the
-- file working as intended.
drop function public.current_user_role();

alter table public.profiles drop column role;
alter table public.profile_invites drop column role;

-- ─────────────────────────────────────────────────────────────
-- 7. Indexes
-- ─────────────────────────────────────────────────────────────
-- The old index was `on (role) where active`, so both its key and its predicate
-- pointed at the column section 6 just dropped — and Postgres drops an index
-- whose column goes away, without asking. `if exists` because of that: a plain
-- `drop index` here fails on a database where the column drop already took it,
-- which is every database that runs this file in order.
drop index if exists public.profiles_active_role_idx;

-- GIN is what serves `roles @> '{pm}'`, which is what `.contains("roles",
-- ["pm"])` sends over the wire. Not partial: a partial index cannot serve a
-- query that does not filter by active, and several of ours do not.
create index profiles_roles_idx on public.profiles using gin (roles);
