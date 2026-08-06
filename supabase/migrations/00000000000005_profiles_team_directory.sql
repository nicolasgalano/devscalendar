-- Feature: 003-calendar-ui
-- Purpose: let any provisioned team member read the rest of the team.
--
-- 001 scoped profile reads to "your own row, or every row if you are an admin".
-- That was enough while /admin/users was the only screen listing people. The
-- calendar shows the assigned developer's name on every block, for every viewer
-- (functional spec §4.2), so a PM has to be able to read a developer's profile
-- — otherwise the embed comes back null and blocks render without a name.
--
-- Deliberately scoped to rows that already have a role: users sitting in
-- pending-access (role null) stay invisible to everyone except themselves and
-- the admins, which is what the 001 test asserts.
--
-- This widens what a non-admin can see (name, email, role of teammates). For an
-- internal planning tool where everyone already sees who is booked on what,
-- that is the intended level of visibility — it is the same call as Q-5
-- (developers see the global calendar in read-only mode).
create policy "profiles: team directory read"
  on public.profiles for select
  to authenticated
  using (role is not null);
