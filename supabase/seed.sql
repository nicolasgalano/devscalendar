-- Seed data for local development.
-- Run with: `supabase db reset` (executes this file automatically after migrations).
--
-- Everything here uses fixed UUIDs so a reset always lands on the same data and
-- you can hardcode ids while debugging:
--
--   …0011/0012 PMs · …0021–0023 developers · …0031/0032 clients
--   …0041/0042 projects · …0051–0059 bookings
--
-- The auth users below exist only to satisfy the profiles FK: they have no
-- usable password, because the real login is Google OAuth. To give *your*
-- Google account a role, use an invite:
--
--   insert into public.profile_invites (email, role) values ('you@example.com', 'admin');
--
-- ...and then log in. The trigger consumes the invite (see ADR 0004).

-- ─────────────────────────────────────────────────────────────
-- 1. People (features 001 / 002)
-- ─────────────────────────────────────────────────────────────
-- The `on_auth_user_created` trigger creates the matching profiles row; the
-- role is assigned right after, since the trigger leaves it null.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000011',
   'authenticated', 'authenticated', 'paula.mendez@seed.local', '!seed-no-login!',
   now(), '{"provider":"seed","providers":["seed"]}', '{"full_name":"Paula Méndez"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000012',
   'authenticated', 'authenticated', 'diego.arce@seed.local', '!seed-no-login!',
   now(), '{"provider":"seed","providers":["seed"]}', '{"full_name":"Diego Arce"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000021',
   'authenticated', 'authenticated', 'cristian.soto@seed.local', '!seed-no-login!',
   now(), '{"provider":"seed","providers":["seed"]}', '{"full_name":"Cristian Soto"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000022',
   'authenticated', 'authenticated', 'malena.rojas@seed.local', '!seed-no-login!',
   now(), '{"provider":"seed","providers":["seed"]}', '{"full_name":"Malena Rojas"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000023',
   'authenticated', 'authenticated', 'rodrigo.paz@seed.local', '!seed-no-login!',
   now(), '{"provider":"seed","providers":["seed"]}', '{"full_name":"Rodrigo Paz"}', now(), now())
on conflict (id) do nothing;

update public.profiles set role = 'pm'
where id in ('00000000-0000-4000-8000-000000000011',
             '00000000-0000-4000-8000-000000000012');

update public.profiles set role = 'developer'
where id in ('00000000-0000-4000-8000-000000000021',
             '00000000-0000-4000-8000-000000000022',
             '00000000-0000-4000-8000-000000000023');

-- Admin access for the local developer.
--
-- `supabase db reset` wipes auth.users, so after every reset a real Google
-- login lands on /pending-access with no role. Seeding the invite means the
-- next login self-heals: the `handle_new_user` trigger consumes it and the
-- profile is born as admin (ADR 0004).
--
-- The second statement covers the case where the profile already exists (you
-- logged in before the seed ran), which the invite alone cannot fix because the
-- trigger only fires on insert.
--
-- Change this email to yours when working on another machine.
insert into public.profile_invites (email, role)
values ('emiliano@wedoweb.co', 'admin')
on conflict (email) do nothing;

update public.profiles
set role = 'admin'
where email = 'emiliano@wedoweb.co' and role is null;

-- ─────────────────────────────────────────────────────────────
-- 2. Clients and projects (feature 002-entities-admin)
-- ─────────────────────────────────────────────────────────────
-- Two clients and two projects with different priorities, so every calendar
-- filter (client, project, PM, priority) has something to filter.
insert into public.clients (id, name)
values
  ('00000000-0000-4000-8000-000000000031', 'Acme Corp'),
  ('00000000-0000-4000-8000-000000000032', 'Nimbus SRL')
on conflict (id) do nothing;

insert into public.projects (id, client_id, name, pm_id, priority, jira_enabled, slack_enabled)
values
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000031',
   'Website Revamp', '00000000-0000-4000-8000-000000000011', 'normal', true, false),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000032',
   'Portal de reservas', '00000000-0000-4000-8000-000000000012', 'high', false, true)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 3. Bookings (feature 003-calendar-ui)
-- ─────────────────────────────────────────────────────────────
-- Anchored to the Monday of the current week, so a reset always lands on a
-- populated day view without editing dates by hand. Wall-clock times are built
-- in the client's timezone, which is the one the calendar renders in (Q-10).
--
-- The fixtures cover, on purpose:
--   · two developers overlapping at the same hour  → parallel lanes (AC-2.2)
--   · a booking on a high-priority project         → priority marker (AC-2.3)
--   · one booking in each of the 5 states          → functional spec §5.2
--   · one outside 09:00–17:00 and one on a Saturday → Q-F / Q-G
-- The last two are rare in production, which is exactly why they belong in the
-- seed: nobody remembers to test by hand what almost never happens.
do $$
declare
  tz constant text := 'America/Argentina/Buenos_Aires';
  monday constant date := date_trunc('week', current_date)::date;
  saturday constant date := (date_trunc('week', current_date)::date) + 5;

  pm_paula constant uuid := '00000000-0000-4000-8000-000000000011';
  pm_diego constant uuid := '00000000-0000-4000-8000-000000000012';
  dev_cristian constant uuid := '00000000-0000-4000-8000-000000000021';
  dev_malena constant uuid := '00000000-0000-4000-8000-000000000022';
  dev_rodrigo constant uuid := '00000000-0000-4000-8000-000000000023';
  proj_website constant uuid := '00000000-0000-4000-8000-000000000041';
  proj_portal constant uuid := '00000000-0000-4000-8000-000000000042';
begin
  insert into public.bookings
    (id, project_id, dev_id, created_by, starts_at, ends_at, status, note, ticket_ref)
  values
    -- Monday, normal working hours.
    ('00000000-0000-4000-8000-000000000051', proj_website, dev_cristian, pm_paula,
     (monday + time '09:00') at time zone tz, (monday + time '13:00') at time zone tz,
     'approved', 'Migración del checkout', 'WEB-142'),
    -- Overlaps the one above in time, different developer → parallel lanes.
    ('00000000-0000-4000-8000-000000000052', proj_website, dev_malena, pm_paula,
     (monday + time '09:00') at time zone tz, (monday + time '12:00') at time zone tz,
     'pending', 'Revisión de diseño responsive', 'WEB-155'),
    -- High-priority project, spans most of the day.
    ('00000000-0000-4000-8000-000000000053', proj_portal, dev_rodrigo, pm_diego,
     (monday + time '10:00') at time zone tz, (monday + time '17:00') at time zone tz,
     'approved', 'Integración de pagos', 'POR-7'),
    ('00000000-0000-4000-8000-000000000054', proj_portal, dev_cristian, pm_diego,
     (monday + time '14:00') at time zone tz, (monday + time '17:00') at time zone tz,
     'pending', null, 'POR-11'),
    ('00000000-0000-4000-8000-000000000055', proj_website, dev_malena, pm_paula,
     (monday + time '13:00') at time zone tz, (monday + time '15:00') at time zone tz,
     'rejected', 'No llega, ya está con otro cliente', null),
    ('00000000-0000-4000-8000-000000000056', proj_website, dev_rodrigo, pm_paula,
     (monday + time '09:00') at time zone tz, (monday + time '10:00') at time zone tz,
     'cancelled', null, null),
    ('00000000-0000-4000-8000-000000000057', proj_website, dev_cristian, pm_paula,
     (monday + time '15:00') at time zone tz, (monday + time '16:00') at time zone tz,
     'displaced', 'Desplazada por Portal de reservas', null),
    -- Outside the 09:00–17:00 workday: exceptional, allowed, never hidden (Q-G).
    ('00000000-0000-4000-8000-000000000058', proj_portal, dev_malena, pm_diego,
     (monday + time '18:00') at time zone tz, (monday + time '20:00') at time zone tz,
     'approved', 'Ventana de deploy', 'POR-19'),
    -- Saturday: non-working day, so the month view flags it as over capacity.
    ('00000000-0000-4000-8000-000000000059', proj_website, dev_rodrigo, pm_paula,
     (saturday + time '10:00') at time zone tz, (saturday + time '14:00') at time zone tz,
     'approved', 'Migración de base, ventana de fin de semana', 'WEB-160')
  -- Idempotent on purpose: re-running the seed without a reset refreshes the
  -- dates to the current week instead of failing on the primary key.
  on conflict (id) do update set
    project_id = excluded.project_id,
    dev_id = excluded.dev_id,
    created_by = excluded.created_by,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    status = excluded.status,
    note = excluded.note,
    ticket_ref = excluded.ticket_ref;
end $$;
