-- Feature: 003-calendar-ui
-- Purpose: bookings table, read-only RLS, range indexes for the calendar views.
--
-- READ THIS BEFORE ADDING WRITES (feature 004-bookings):
-- This table is deliberately read-only. The calendar has to render bookings to
-- meet its own acceptance criteria, so the table is born here, but every write
-- path belongs to 004: policies, the anti double-booking exclusion constraint
-- and the state machine. See specs/features/003-calendar-ui/plan.md §3.1.
-- Until then only `service_role` writes (seed + test fixtures).

-- ─────────────────────────────────────────────────────────────
-- 1. Bookings
-- ─────────────────────────────────────────────────────────────
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  -- `restrict`: a booking needs its project and its developer. Deactivate,
  -- don't delete — same convention as projects.client_id / projects.pm_id.
  project_id uuid not null references public.projects(id) on delete restrict,
  dev_id uuid not null references public.profiles(id) on delete restrict,
  -- `set null`: the booking outlives the PM who created it. Removing a user
  -- must never be blocked by this link (the 002 lifecycle bug).
  created_by uuid references public.profiles(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- The five states of the functional spec §5.2. A `check` rather than an enum:
  -- Q-6 is still open and migrating a check is cheap (same call as
  -- projects.priority — see 002/plan.md §9).
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'displaced')),
  note text,
  -- Filled in by 008 (Jira) / 009 (Slack). Nullable on purpose.
  ticket_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_ends_after_starts check (ends_at > starts_at)
);

-- No `priority` column: it is resolved by joining projects.priority. Copying it
-- would need syncing on every project priority change, which is exactly the
-- event 002 already audits. See 003/plan.md §3.2.

comment on table public.bookings is
  'Time reserved for a developer on a project. Read-only until feature 004 adds the write path.';

-- ─────────────────────────────────────────────────────────────
-- 2. Indexes
-- ─────────────────────────────────────────────────────────────
-- Day view grouped by developer, and the developer filter.
create index bookings_dev_id_starts_at_idx on public.bookings (dev_id, starts_at);
-- Day view grouped by project, and the project filter.
create index bookings_project_id_starts_at_idx on public.bookings (project_id, starts_at);
-- Range scan for the month and year views.
create index bookings_starts_at_idx on public.bookings (starts_at);

-- The GiST index over tstzrange(starts_at, ends_at) belongs to the exclusion
-- constraint in 004. Not created here: nothing in 003 needs it.

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. Row Level Security
-- ─────────────────────────────────────────────────────────────
alter table public.bookings enable row level security;

-- Least privilege: `authenticated` only gets select. Writes are blocked twice
-- over — no grant and no policy — and 004 has to add both. A test asserts the
-- write fails; both reasons are intentional.
grant select on public.bookings to authenticated;
grant all on public.bookings to service_role;

-- Q-5 default (functional spec §11): the developer sees the global calendar in
-- read-only mode. If the client decides otherwise, this policy is the one place
-- that changes — the views already filter by developer.
--
-- Gated on having a role, not merely on being authenticated. Anyone with a
-- Google account can complete the OAuth flow and hold a valid session; until an
-- admin activates them they sit in /pending-access, and an unactivated account
-- has no business reading who is booked on what, with which ticket and note.
-- Same criterion as the profiles directory policy in migration 05.
create policy "bookings: team read"
  on public.bookings for select
  to authenticated
  using (public.current_user_role() is not null);
