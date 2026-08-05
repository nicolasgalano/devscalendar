-- Feature: 002-entities-admin
-- Purpose: primary_pm_id on profiles, profile_invites (email -> role) so an admin
--          can pre-assign a role before a user's first Google login, and extend
--          handle_new_user() to consume a matching invite.

-- ─────────────────────────────────────────────────────────────
-- 1. profiles.primary_pm_id
-- ─────────────────────────────────────────────────────────────
-- Role of the referenced profile (must be 'pm') is validated in the application
-- layer, not here — see spec.md R-3.
-- `set null`: dar de baja a un PM no puede quedar bloqueado por los devs que lo
-- tenían como PM primario; simplemente se quedan sin uno.
alter table public.profiles
  add column primary_pm_id uuid references public.profiles(id) on delete set null;

-- ─────────────────────────────────────────────────────────────
-- 2. profile_invites
-- ─────────────────────────────────────────────────────────────
create table public.profile_invites (
  email text primary key,
  role public.user_role not null,
  -- `set null`: la invitación sobrevive a la baja de quien la envió.
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.profile_invites enable row level security;

grant select, insert, update, delete on public.profile_invites to authenticated;
grant all on public.profile_invites to service_role;

create policy "profile_invites: admin all"
  on public.profile_invites for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ─────────────────────────────────────────────────────────────
-- 3. Extend handle_new_user(): consume a matching invite if present.
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_role public.user_role;
begin
  delete from public.profile_invites
  where email = new.email
  returning role into invited_role;

  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    invited_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
