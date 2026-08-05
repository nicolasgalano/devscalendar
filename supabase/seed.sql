-- Seed data for local development.
-- Run with: `supabase db reset` (executes this file automatically after migrations).
--
-- Seed real users via the Supabase Studio (http://localhost:54323) or via
-- `supabase auth` commands, then set their role manually:
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';

-- ─────────────────────────────────────────────────────────────
-- Feature 002-entities-admin: 1 client + 1 project fixture.
-- ─────────────────────────────────────────────────────────────
insert into public.clients (name)
values ('Acme Corp')
on conflict (name) do nothing;

-- The project needs a PM profile (pm_id is not null). On a fresh reset there
-- are no auth users yet, so this only runs once you've created a user and
-- set their role to 'pm' (see comment above), then run `supabase db reset`
-- again or re-run this block by hand.
do $$
declare
  seed_client_id uuid;
  seed_pm_id uuid;
begin
  select id into seed_client_id from public.clients where name = 'Acme Corp';
  select id into seed_pm_id from public.profiles where role = 'pm' limit 1;

  if seed_pm_id is not null then
    insert into public.projects (client_id, name, pm_id, priority)
    values (seed_client_id, 'Website Revamp', seed_pm_id, 'normal')
    on conflict (client_id, name) do nothing;
  end if;
end $$;
