-- One-shot que corrió contra el proyecto remoto (`gnasmpblvarluuwtjprq`) el
-- 2026-09-08 para reemplazar la ficción de la seed por el roster real de
-- WeDo Web. Se conserva como registro histórico, **no lo ejecuta ningún
-- pipeline**: no está en `supabase/seed.sql`, no lo referencia `pnpm db:seed`,
-- y CI ni siquiera lo mira.
--
-- Por qué el registro sí importa: el remoto es también la base del deploy de
-- Vercel (ver CLAUDE.md), y este script explica cómo llegó al estado que
-- tiene si algún día hay que reconstruirlo. La fuente de la data está en
-- `docs/wedoweb-equipo-clientes-proyectos.md`.
--
-- Se corrió en tres tandas separadas, no todo junto. Se replica acá con la
-- misma estructura para que sea legible; si algún día se re-ejecuta, es
-- seguro re-correrlo entero (todo idempotente).
--
-- Cómo se ejecutó: `pnpm exec supabase db query --linked "<cada bloque>"`.

-- ─────────────────────────────────────────────────────────────
-- Tanda 1 — Purga de los dummies y alta del equipo
-- ─────────────────────────────────────────────────────────────
-- Borra las entidades con UUIDs `…0011`–`…005e` (la seed de ficción) y
-- crea a Cris, Matías y Bruno como developers. Brenda pasa de {admin} a
-- {pm}. Emi y Nico se suman a `profile_invites` como fallback.

delete from public.bookings where id in (
  '00000000-0000-4000-8000-000000000051',
  '00000000-0000-4000-8000-000000000052',
  '00000000-0000-4000-8000-000000000053',
  '00000000-0000-4000-8000-000000000054',
  '00000000-0000-4000-8000-000000000055',
  '00000000-0000-4000-8000-000000000056',
  '00000000-0000-4000-8000-000000000057',
  '00000000-0000-4000-8000-000000000058',
  '00000000-0000-4000-8000-000000000059',
  '00000000-0000-4000-8000-00000000005a',
  '00000000-0000-4000-8000-00000000005b',
  '00000000-0000-4000-8000-00000000005c',
  '00000000-0000-4000-8000-00000000005d',
  '00000000-0000-4000-8000-00000000005e'
);

delete from public.projects where id in (
  '00000000-0000-4000-8000-000000000041',
  '00000000-0000-4000-8000-000000000042'
);

delete from public.clients where id in (
  '00000000-0000-4000-8000-000000000031',
  '00000000-0000-4000-8000-000000000032'
);

delete from auth.users where id in (
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000022',
  '00000000-0000-4000-8000-000000000023'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000104',
   'authenticated', 'authenticated', 'cris@wedoweb.co', '!seed-no-login!',
   now(), '{"provider":"seed","providers":["seed"]}', '{"full_name":"Cris"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000105',
   'authenticated', 'authenticated', 'matias@wedoweb.co', '!seed-no-login!',
   now(), '{"provider":"seed","providers":["seed"]}', '{"full_name":"Matías"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000106',
   'authenticated', 'authenticated', 'bruno@wedoweb.co', '!seed-no-login!',
   now(), '{"provider":"seed","providers":["seed"]}', '{"full_name":"Bruno"}', now(), now())
on conflict do nothing;

update public.profiles set roles = array['developer']::public.user_role[]
where id in ('00000000-0000-4000-8000-000000000104',
             '00000000-0000-4000-8000-000000000105',
             '00000000-0000-4000-8000-000000000106')
  and not ('developer' = any(roles));

update public.profiles set roles = array['pm']::public.user_role[]
where email = 'brenda@wedoweb.co' and roles is distinct from array['pm']::public.user_role[];

insert into public.profile_invites (email, roles)
values
  ('emiliano@wedoweb.co', array['admin']::public.user_role[]),
  ('nico@wedoweb.co', array['admin']::public.user_role[])
on conflict (email) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Tanda 2 — Clientes que faltaban del doc
-- ─────────────────────────────────────────────────────────────
-- Andocia, Consensus, Hendy y Shakespear ya estaban cargados por UI —
-- se reusan por nombre en la Tanda 3. Los 5 restantes se agregan con
-- UUIDs fijos 0x0203–0x0207. CFAM y Kimjera (no aparecen en el doc)
-- quedaron intactos.

insert into public.clients (id, name)
values
  ('00000000-0000-4000-8000-000000000203', 'Outcomes Rocket'),
  ('00000000-0000-4000-8000-000000000204', 'Colegio Franco'),
  ('00000000-0000-4000-8000-000000000205', 'iLoan'),
  ('00000000-0000-4000-8000-000000000206', 'Latin Securities'),
  ('00000000-0000-4000-8000-000000000207', 'EE Reed East')
on conflict (name) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Tanda 3 — Proyectos del doc, todos con Brenda como PM interina
-- ─────────────────────────────────────────────────────────────
-- Los 7 proyectos que había por UI (Santori & Peters, HVS, Hilco
-- Global, EEREC, Brechner, CFAM, Hendy) se borraron previamente con un
-- `delete from public.projects` — no había bookings que los
-- referenciaran, así que el `on delete restrict` no molestó.
--
-- El script busca las ids por email (Brenda) y por nombre (clientes)
-- porque los reales son UUIDs random creados por OAuth / UI, no los
-- fijos que uno controlaría.
--
-- `iLoan WP` aparece dos veces en la planilla con distinto dev, así
-- que se cargan como "iLoan WP (Matías)" y "iLoan WP (Cris)" para
-- distinguirlas — el modelo no tiene unique por (client_id, name) pero
-- dos filas con el mismo nombre confunden en la UI.

do $$
declare
  brenda_id      uuid;
  consensus_id   uuid;
  andocia_id     uuid;
  outcomes_id    uuid;
  colegio_id     uuid;
  iloan_id       uuid;
  latin_id       uuid;
  ereed_id       uuid;
  hendy_id       uuid;
  shakespear_id  uuid;
begin
  select id into brenda_id from public.profiles where email = 'brenda@wedoweb.co';
  if brenda_id is null then
    raise exception 'No hay profile para brenda@wedoweb.co — la Tanda 1 tiene que haber corrido primero';
  end if;

  select id into consensus_id  from public.clients where name = 'Consensus';
  select id into andocia_id    from public.clients where name = 'Andocia';
  select id into outcomes_id   from public.clients where name = 'Outcomes Rocket';
  select id into colegio_id    from public.clients where name = 'Colegio Franco';
  select id into iloan_id      from public.clients where name = 'iLoan';
  select id into latin_id      from public.clients where name = 'Latin Securities';
  select id into ereed_id      from public.clients where name = 'EE Reed East';
  select id into hendy_id      from public.clients where name = 'Hendy';
  select id into shakespear_id from public.clients where name = 'Shakespear';

  insert into public.projects (client_id, name, pm_id, priority, jira_enabled, slack_enabled)
  values
    (consensus_id,  'EtaPro',            brenda_id, 'normal', false, false),
    (consensus_id,  'Hilco',             brenda_id, 'normal', false, false),
    (andocia_id,    'HTM',               brenda_id, 'normal', false, false),
    (andocia_id,    'Varios',            brenda_id, 'normal', false, false),
    (outcomes_id,   'PemPal',            brenda_id, 'normal', false, false),
    (outcomes_id,   'OR Site',           brenda_id, 'normal', false, false),
    (outcomes_id,   'Retia',             brenda_id, 'normal', false, false),
    (outcomes_id,   'Otros',             brenda_id, 'normal', false, false),
    (colegio_id,    'CFA',               brenda_id, 'normal', false, false),
    (iloan_id,      'iCentral',          brenda_id, 'normal', false, false),
    (iloan_id,      'iLoan WP (Matías)', brenda_id, 'normal', false, false),
    (iloan_id,      'iLoan WP (Cris)',   brenda_id, 'normal', false, false),
    (latin_id,      'Delta',             brenda_id, 'normal', false, false),
    (ereed_id,      'General',           brenda_id, 'normal', false, false),
    (hendy_id,      'Hendy',             brenda_id, 'normal', false, false),
    (shakespear_id, 'Brechner',          brenda_id, 'normal', false, false);
end $$;
