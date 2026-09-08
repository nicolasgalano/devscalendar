-- Seed data — Purga de la ficción original + alta de las 3 personas del
-- equipo WeDo Web que faltaban (Cris, Matías, Bruno).
--
-- Historia: hasta el 2026-09-06 esto era una seed de ficción (Paula/Diego,
-- Acme/Nimbus, 15 reservas). El 2026-09-07 pasa a ser una **corrida final
-- one-shot**: purga las entidades de demo por id (UUIDs `…0011`–`…005e`),
-- crea a las tres personas faltantes con UUIDs fijos, y **no toca ni
-- clientes ni proyectos** — para cuando corrió esta seed, los clientes y
-- proyectos reales ya estaban cargados a mano por /admin con nombres que
-- diverjen del doc de referencia (por ejemplo, "CFAM" en vez de "Colegio
-- Franco", "Kimjera" que no está en el doc, etc.). Un insert por nombre
-- fallaba por unique constraint, y meter los ids fijos crearía duplicados.
--
-- **Última vez que este archivo carga datos "de arranque".** De ahora en
-- más todo alta pasa por /admin. La corrida siguiente de db:seed es
-- idempotente (no-op) por diseño.
--
-- UUIDs estables introducidos:
--   0x0104–0x0106  Cris, Matías, Bruno (los que faltaban en el equipo)
--
-- Personas del equipo que ya existen en la base con UUIDs random (OAuth):
-- Brenda, Lucía, Emi, Nico. Brenda se pasa a `roles = {pm}` porque el
-- usuario la eligió PM interina de los proyectos (2026-09-07); los demás
-- no se tocan.
--
-- Ejecución: `pnpm db:seed` sobre el proyecto enlazado.

-- ─────────────────────────────────────────────────────────────
-- 0. Limpieza de la ficción de demo
-- ─────────────────────────────────────────────────────────────
-- Orden por los `on delete restrict`: bookings → projects → clients →
-- auth.users (cascadea a profiles). Todo por id, nunca por nombre, para no
-- llevarse por delante datos reales.

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

-- ─────────────────────────────────────────────────────────────
-- 1. Personas que faltan — Cris, Matías, Bruno
-- ─────────────────────────────────────────────────────────────
-- El trigger `on_auth_user_created` crea la fila en profiles con roles
-- vacío; el update de abajo la fija a developer.
--
-- Matías y Bruno viajan con emails placeholder `@wedoweb.co` — no son fijos
-- del equipo y el doc no tiene su casilla real (PENDIENTE #2, #3, #5).

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
-- Sin target: cubre choques por id **y** por email. Si algún día alguien
-- creó `cris@wedoweb.co` por otro camino, esta línea no la re-inserta.
on conflict do nothing;

-- Migración 9 reemplazó `profiles.role` por `profiles.roles` (array). El
-- trigger `profiles_normalise_roles` ordena y deduplica en cada write.
update public.profiles set roles = array['developer']::public.user_role[]
where id in ('00000000-0000-4000-8000-000000000104',
             '00000000-0000-4000-8000-000000000105',
             '00000000-0000-4000-8000-000000000106')
  and not ('developer' = any(roles));

-- ─────────────────────────────────────────────────────────────
-- 2. Brenda pasa a pm
-- ─────────────────────────────────────────────────────────────
-- Estaba admin en la base; el usuario la eligió PM (2026-09-07). Se
-- reemplaza `{admin}` (o `{admin,pm}` si esta seed corrió parcial) por
-- `{pm}`. Con el modelo multi-rol podría ser `{pm, admin}`, pero el doc la
-- lista solo como PM. Si necesita admin de nuevo, se agrega vía /admin/users.
update public.profiles set roles = array['pm']::public.user_role[]
where email = 'brenda@wedoweb.co' and roles is distinct from array['pm']::public.user_role[];

-- ─────────────────────────────────────────────────────────────
-- 3. Invitaciones de admin — Emi y Nico
-- ─────────────────────────────────────────────────────────────
-- Emi y Nico ya son admin en la base (login OAuth). Las invitaciones
-- quedan como fallback si algún día se recrea el profile o cambian de
-- cuenta.
insert into public.profile_invites (email, roles)
values
  ('emiliano@wedoweb.co', array['admin']::public.user_role[]),
  ('nico@wedoweb.co', array['admin']::public.user_role[])
on conflict (email) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 4. Clientes y proyectos — no se cargan desde acá
-- ─────────────────────────────────────────────────────────────
-- Los clientes y proyectos reales se administran desde /admin. El intento
-- inicial de sembrarlos por seed (2026-09-07) chocó con nombres únicos ya
-- cargados a mano — el equipo estaba usando el ABM antes de esta seed.
-- Cargar por UI evita ese doble camino y deja la seed más chica.

-- ─────────────────────────────────────────────────────────────
-- 5. Bookings
-- ─────────────────────────────────────────────────────────────
-- Ninguna. Se cargan desde /calendar. La empty state que dejó 011 muestra
-- la grilla vacía en vez del cartel de "sin reservas".
