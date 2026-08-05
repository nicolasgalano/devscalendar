-- Feature: 002-entities-admin
-- Purpose: clients and projects master tables, admin-only RLS, updated_at triggers.

-- ─────────────────────────────────────────────────────────────
-- 1. Clients
-- ─────────────────────────────────────────────────────────────
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. Projects
-- ─────────────────────────────────────────────────────────────
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  -- `restrict` a propósito: un cliente o un PM con proyectos no se borra,
  -- se desactiva (soft delete). Ver spec.md AC-1.2.
  client_id uuid not null references public.clients(id) on delete restrict,
  name text not null,
  pm_id uuid not null references public.profiles(id) on delete restrict,
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  jira_enabled boolean not null default false,
  slack_enabled boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, name)
);

create index projects_client_id_idx on public.projects (client_id);
create index projects_pm_id_active_idx on public.projects (pm_id) where active;

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. Row Level Security
-- ─────────────────────────────────────────────────────────────
alter table public.clients enable row level security;
alter table public.projects enable row level security;

-- RLS policies only take effect once the role has the underlying table grant
-- (bug from 001: a policy without a matching grant silently denies everything).
grant select, insert, update, delete on public.clients to authenticated;
grant all on public.clients to service_role;
grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;

-- Any authenticated user can read the master data (needed to browse bookings).
create policy "clients: authenticated read"
  on public.clients for select
  to authenticated
  using (true);

create policy "clients: admin write"
  on public.clients for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "projects: authenticated read"
  on public.projects for select
  to authenticated
  using (true);

create policy "projects: admin write"
  on public.projects for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
