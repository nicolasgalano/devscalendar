-- Feature: 013-registered-debt-cleanup
-- Purpose: the two registered debts that live in policies.
--
--   F7 (003) / D-02  reading the masters required nothing but a session. The
--                    select policies of clients and projects were `using (true)`,
--                    so anyone who completed the Google OAuth flow — including
--                    someone sitting in /pending-access whom nobody has enabled —
--                    could read the company's client and project list over the
--                    API. bookings and profiles already demanded a role; these
--                    two were left behind.
--
--   D-08 (004)       deactivating a project stopped it from being offered in the
--                    dropdown and nothing else. With the id in hand, a booking
--                    went in anyway. 002 AC-1.2 asks for a soft delete precisely
--                    because there is history to preserve, and letting new
--                    history be written onto the row empties that intent.
--
-- No schema changes: three policies recreated, nothing added or dropped.

-- ─────────────────────────────────────────────────────────────
-- 1. Reading the masters requires being provisioned
-- ─────────────────────────────────────────────────────────────
-- `has_any_role()` (012) already folds in `and active`, so this aligns the four
-- tables — bookings, profiles, clients, projects — behind one criterion, and a
-- deactivated user loses the masters at the same time as everything else.
--
-- The policy names stay as they are even though "authenticated" is no longer the
-- whole truth: renaming means hunting the old name across three migrations and
-- the tests, in exchange for nothing. This comment carries what the name
-- doesn't.
drop policy "clients: authenticated read" on public.clients;
create policy "clients: authenticated read"
  on public.clients for select
  to authenticated
  using (public.has_any_role());

drop policy "projects: authenticated read" on public.projects;
create policy "projects: authenticated read"
  on public.projects for select
  to authenticated
  using (public.has_any_role());

-- ─────────────────────────────────────────────────────────────
-- 2. A deactivated project takes no new bookings
-- ─────────────────────────────────────────────────────────────
-- **In the insert policy, not in can_manage_booking().** That function is shared
-- by this policy, by `bookings: manager update` and by reallocate_booking(), so
-- putting the check there would also freeze the existing bookings of a
-- deactivated project — exactly what its PM needs to be able to cancel after
-- deactivating it. Blocking new history is the point; freezing the old one is
-- not (spec AC-4.2).
--
-- reallocate_booking() needs no change: it has checked `p.active` since 006,
-- raising DC004. Same story as D-01 — the newest path did it right.
drop policy "bookings: manager insert" on public.bookings;
create policy "bookings: manager insert"
  on public.bookings for insert
  to authenticated
  with check (
    public.can_manage_booking(project_id)
    and exists (
      select 1
      from public.projects
      where id = project_id
        and active
    )
  );
