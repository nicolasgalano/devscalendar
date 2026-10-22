-- Feature: 029-project-capacity-planning
-- Purpose: tabla `capacity_estimates` + dos RPCs security definer para
--          upsert y delete. Patrón ADR 0010 heredado de 028: la escritura
--          va por RPCs y las policies de INSERT/UPDATE/DELETE no existen,
--          así que una policy olvidada o un `with check` ausente no abre
--          una puerta nueva — no hay puerta.
--
-- Convive con bookings sin cruzarse (dos ejes distintos: intención por día vs
-- compromiso con horario). Las estimaciones viejas de un dev dado de baja del
-- proyecto se mantienen — son historia útil para el futuro reporte "plan vs
-- real".
--
-- Aditiva pura. No altera tablas ni policies existentes.

-- ─────────────────────────────────────────────────────────────
-- 1. Tabla
-- ─────────────────────────────────────────────────────────────
create table public.capacity_estimates (
  id uuid primary key default gen_random_uuid(),
  -- cascade por los dos lados: precedente en project_members de 015. La
  -- estimación sin su proyecto o sin su dev no significa nada. Projects y
  -- profiles en la práctica no se borran (se desactivan), así que el cascade
  -- solo dispara si alguien hace `delete from projects` directo — camino
  -- deliberadamente destructivo.
  project_id uuid not null references public.projects(id) on delete cascade,
  dev_id uuid not null references public.profiles(id) on delete cascade,
  -- `date` y no `timestamptz` a propósito: la unidad semántica es el día
  -- calendario. La UI resuelve zona horaria del lado del cliente antes de
  -- enviar; la DB almacena el día ya resuelto. Mismo criterio que
  -- time_entries.date de 016.
  date date not null,
  -- numeric(4,2): hasta 99.99 h de representación, acotado por el check a
  -- (0, 24]. Granularidad de 15 min viene de la UI con step=0.25 (patrón
  -- de time_entries); el check no la impone para no acoplar DB a decisión
  -- de UI (si mañana el equipo quiere 1 min, es un cambio local).
  hours numeric(4,2) not null check (hours > 0 and hours <= 24),
  -- `set null`: el rastro de quién cargó la estimación sobrevive a la baja
  -- del profile y nunca bloquea borrarlo. Convención del repo para
  -- referencias blandas a profiles.
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Clave natural: una estimación por (proyecto, dev, día). El upsert la
  -- convierte en "idempotente por tripla" sin que el cliente tenga que
  -- elegir entre POST y PATCH mirando primero si existe la fila.
  unique (project_id, dev_id, date)
);

create index capacity_estimates_project_date_idx
  on public.capacity_estimates (project_id, date);

-- Para futuras queries cross-proyecto (ver carga total de un dev X en un
-- rango). Fuera de alcance del MVP pero el índice es gratis acá.
create index capacity_estimates_dev_date_idx
  on public.capacity_estimates (dev_id, date);

create trigger capacity_estimates_set_updated_at
  before update on public.capacity_estimates
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. RLS + grants
-- ─────────────────────────────────────────────────────────────
alter table public.capacity_estimates enable row level security;

-- NO grant INSERT/UPDATE/DELETE a authenticated. Las dos RPCs son el único
-- camino de escritura — como security definer corren con privilegio del
-- owner, no necesitan grants extra. Si en el futuro aparece una policy
-- directa, hay que agregar el grant *y* la policy; omitir el grant deja
-- la policy "silently denied" (bug de 001 que la convención del repo
-- repite para no olvidar).
grant select on public.capacity_estimates to authenticated;
grant all on public.capacity_estimates to service_role;

create policy "capacity_estimates: project viewer read"
  on public.capacity_estimates for select
  to authenticated
  using (public.can_view_project(project_id));

-- ─────────────────────────────────────────────────────────────
-- 3. RPC — upsert
-- ─────────────────────────────────────────────────────────────
create or replace function public.upsert_capacity_estimate(
  p_project_id uuid,
  p_dev_id uuid,
  p_date date,
  p_hours numeric
)
returns public.capacity_estimates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pm_id uuid;
  v_project_active boolean;
  v_result public.capacity_estimates;
begin
  -- 1) Rango de horas. El `check` de la tabla también lo captura pero con
  --    SQLSTATE 23514 ("check_violation"), que es menos legible desde el
  --    handler. Levantarlo acá con DC011 da un mensaje concreto.
  if p_hours <= 0 or p_hours > 24 then
    raise exception 'Las horas estimadas deben estar entre 0.25 y 24'
      using errcode = 'DC011';
  end if;

  -- 2) Proyecto existe + está activo. Un proyecto desactivado no acepta
  --    estimaciones nuevas, análogo a D-08 de bookings. `for share` toma
  --    lock de fila para que un desactivar concurrente no deje una
  --    estimación huérfana entre el check y el insert.
  select pm_id, active
    into v_pm_id, v_project_active
    from public.projects
   where id = p_project_id
     for share;

  if v_pm_id is null or not v_project_active then
    raise exception 'Proyecto no encontrado o desactivado'
      using errcode = 'DC004';
  end if;

  -- 3) Autorización: admin O PM primario del proyecto. has_role() incluye
  --    `and active` (D-01), así que ni admin desactivado ni PM primario
  --    desactivado como profile pasan — aunque `projects.pm_id` siga
  --    apuntando a él.
  if not (
    public.has_role('admin'::public.user_role)
    or (v_pm_id = auth.uid() and public.has_role('pm'::public.user_role))
  ) then
    raise exception 'Solo admin o PM primario puede cargar estimaciones'
      using errcode = '42501';
  end if;

  -- 4) El dev tiene que ser miembro activo del proyecto O el PM primario
  --    (que puede no tener fila en project_members si fue agregado a
  --    posteriori por `projects.pm_id` sin pasar por el trigger
  --    autoadd_pm_as_lead). La UI debería no dejar llegar acá un dev
  --    inválido — este check es defense in depth.
  if not (
    exists (
      select 1
        from public.project_members
       where project_id = p_project_id
         and user_id = p_dev_id
         and active
    )
    or v_pm_id = p_dev_id
  ) then
    raise exception 'El desarrollador no es miembro activo del proyecto'
      using errcode = 'DC012';
  end if;

  -- 5) Upsert por clave natural. `created_by` se congela al insert y no
  --    cambia en update (el update solo pisa `hours`; `updated_at` lo
  --    mueve el trigger set_updated_at).
  insert into public.capacity_estimates (
    project_id, dev_id, date, hours, created_by
  )
  values (
    p_project_id, p_dev_id, p_date, p_hours, auth.uid()
  )
  on conflict (project_id, dev_id, date)
  do update set hours = excluded.hours
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.upsert_capacity_estimate(uuid, uuid, date, numeric)
  from public;
grant execute on function public.upsert_capacity_estimate(uuid, uuid, date, numeric)
  to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. RPC — delete
-- ─────────────────────────────────────────────────────────────
create or replace function public.delete_capacity_estimate(
  p_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_pm_id uuid;
begin
  -- `for update` para la misma razón que el `for share` del upsert: evita
  -- que dos deletes concurrentes se pisen con mensajes contradictorios.
  select project_id
    into v_project_id
    from public.capacity_estimates
   where id = p_id
     for update;

  if v_project_id is null then
    raise exception 'Estimación no encontrada'
      using errcode = 'DC010';
  end if;

  -- A diferencia de upsert, delete no chequea `projects.active`: un
  -- proyecto desactivado tiene que seguir pudiendo limpiar sus estimaciones
  -- viejas. Análogo a D-08 de bookings — se cancelan reservas aun en
  -- proyectos desactivados.
  select pm_id
    into v_pm_id
    from public.projects
   where id = v_project_id;

  if not (
    public.has_role('admin'::public.user_role)
    or (v_pm_id = auth.uid() and public.has_role('pm'::public.user_role))
  ) then
    raise exception 'Solo admin o PM primario puede borrar estimaciones'
      using errcode = '42501';
  end if;

  delete from public.capacity_estimates where id = p_id;
  return true;
end;
$$;

revoke all on function public.delete_capacity_estimate(uuid) from public;
grant execute on function public.delete_capacity_estimate(uuid) to authenticated;
