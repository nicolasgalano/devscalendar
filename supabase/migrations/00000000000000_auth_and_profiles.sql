-- Feature: 001-auth-and-permissions
-- Purpose: role enum, profiles table linked to auth.users, RLS policies,
--          helper to read current user's role, and auto-provisioning trigger.

-- ─────────────────────────────────────────────────────────────
-- 1. Enum of application roles
-- ─────────────────────────────────────────────────────────────
create type public.user_role as enum ('admin', 'pm', 'developer');

-- ─────────────────────────────────────────────────────────────
-- 2. Profiles table
-- ─────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  avatar_url text,
  role public.user_role,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_active_role_idx on public.profiles (role) where active;

-- Keep updated_at fresh.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. Helper to read the current user's role without recursion
-- ─────────────────────────────────────────────────────────────
-- SECURITY DEFINER bypasses RLS when reading profiles from within a policy,
-- avoiding the "policy reads profiles which triggers the same policy" loop.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Row Level Security on profiles
-- ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

-- RLS policies only take effect once the role has the underlying table grant.
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- Any authenticated user can read their own profile.
create policy "profiles: self read"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- Admins can read every profile.
create policy "profiles: admin read all"
  on public.profiles for select
  to authenticated
  using (public.current_user_role() = 'admin');

-- Only admins can insert/update/delete profiles (assign roles, deactivate, etc.).
create policy "profiles: admin write"
  on public.profiles for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ─────────────────────────────────────────────────────────────
-- 5. Auto-provisioning: when a new auth.users row is created,
--    insert a matching profiles row (role stays null until an admin
--    assigns one).
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
