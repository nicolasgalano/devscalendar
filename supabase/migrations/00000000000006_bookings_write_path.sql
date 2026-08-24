-- Feature: 004-bookings
-- Purpose: the write path for bookings — anti double-booking constraint,
--          write policies, grants, and the guard on status transitions.
--
-- Feature 003 shipped this table read-only (see its plan.md §3.1). Everything
-- here is what turns it writable.

-- ─────────────────────────────────────────────────────────────
-- 1. Anti double-booking (AC-4.1)
-- ─────────────────────────────────────────────────────────────
-- GiST has no equality operator for uuid out of the box; btree_gist adds it.
create extension if not exists btree_gist with schema extensions;

alter table public.bookings
  add constraint bookings_no_overlap
  -- The operator class is schema-qualified on purpose: Supabase installs
  -- extensions into `extensions`, and if that schema is not on the search_path
  -- while this migration runs, the statement fails with "data type uuid has no
  -- default operator class for access method gist".
  exclude using gist (
    dev_id extensions.gist_uuid_ops with =,
    tstzrange(starts_at, ends_at) with &&
  )
  -- Only approved bookings exclude each other (AC-4.2): two PMs have to be able
  -- to propose the same slot to the same developer, and let them decide. The
  -- conflict materialises on approval, not on proposal.
  where (status = 'approved');

comment on constraint bookings_no_overlap on public.bookings is
  'Anti double-booking: a developer cannot hold two approved bookings whose time ranges overlap. tstzrange defaults to [), so 09:00-13:00 and 13:00-17:00 do not collide.';

-- ─────────────────────────────────────────────────────────────
-- 2. Who may write
-- ─────────────────────────────────────────────────────────────
-- Functional spec §3: a PM creates and edits bookings *on their own projects*.
-- `security definer` so the check does not recurse through the RLS of projects.
create or replace function public.can_manage_booking(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin'
      or exists (
        select 1
        from public.projects
        where id = target_project
          and pm_id = auth.uid()
      );
$$;

revoke all on function public.can_manage_booking(uuid) from public;
grant execute on function public.can_manage_booking(uuid) to authenticated;

-- A policy without the table grant denies everything in silence (the bug from
-- 001). No `delete`: cancelling is an update of `status`, so the booking keeps
-- showing on the calendar with its state and 010 still has the trail.
grant insert, update on public.bookings to authenticated;

create policy "bookings: manager insert"
  on public.bookings for insert
  to authenticated
  with check (public.can_manage_booking(project_id));

create policy "bookings: manager update"
  on public.bookings for update
  to authenticated
  using (public.can_manage_booking(project_id))
  with check (public.can_manage_booking(project_id));

-- ─────────────────────────────────────────────────────────────
-- 3. Approving is the developer's call, not the PM's
-- ─────────────────────────────────────────────────────────────
-- Without this, the update policy above would let a PM set status = 'approved'
-- on their own booking and self-approve, which empties the approval flow of any
-- meaning — the whole point of the product per functional spec §6.
--
-- A policy cannot express it: `with check` only sees the new row, and a plain
-- "status must be pending or cancelled" rule would also block editing the note
-- of an already approved booking, which Q-E says must stay approved. Comparing
-- old against new needs a trigger.
create or replace function public.enforce_booking_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved', 'rejected')
     -- auth.uid() is null for service_role: seeds and test fixtures set states
     -- directly, and they are trusted by definition.
     and auth.uid() is not null
     and auth.uid() is distinct from new.dev_id
  then
    raise exception 'Solo el desarrollador asignado puede aprobar o rechazar una reserva'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger bookings_enforce_status_transition
  before update on public.bookings
  for each row execute function public.enforce_booking_status_transition();
