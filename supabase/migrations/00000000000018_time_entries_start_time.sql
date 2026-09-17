-- ─────────────────────────────────────────────────────────────
-- 016 · Rediseño del dialog de carga: persistir start_time
-- ─────────────────────────────────────────────────────────────
-- El dialog nuevo (estilo TrackingTime) tiene inputs de "de 09:00 a 10:58".
-- Con `minutes` sola, al reeditar una carga vieja el "from" volvía al default
-- (09:00) y se perdía la hora exacta que el user había puesto.
--
-- Se agrega `start_time time null` — la hora exacta en zona local
-- (America/Argentina/Buenos_Aires) en la que arrancó ese bloque de trabajo.
-- El `end_time` se deriva de `start_time + minutes` en el UI (no se guarda).
--
-- Nullable: entries viejas creadas antes de esta migration no lo tienen.
-- El UI muestra defaults cuando null.
--
-- El RPC `stop_timer` (de la migration 17) se recrea para setear el
-- start_time desde `active_timers.started_at` — así el UI ve la hora exacta
-- de arranque del cronómetro al re-editar el entry recién parado.
-- ─────────────────────────────────────────────────────────────

alter table public.time_entries
  add column start_time time;

-- Recrear el RPC stop_timer para setear start_time desde el timer que se para.
create or replace function public.stop_timer(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timer  public.active_timers%rowtype;
  v_minutes int;
  v_entry_id uuid;
  v_logged_at date;
  v_start_local timestamp;
  v_start_time time;
begin
  select * into v_timer from public.active_timers where user_id = p_user_id;
  if not found then return null; end if;

  v_minutes := greatest(
    15,
    (extract(epoch from (now() - v_timer.started_at)) / 60 / 15)::int * 15
  );

  -- started_at es timestamptz (UTC). Lo convertimos a zona local para
  -- extraer la hora del día que el user vio arrancando el timer.
  v_start_local := v_timer.started_at at time zone 'America/Argentina/Buenos_Aires';
  v_logged_at := v_start_local::date;
  v_start_time := v_start_local::time;

  insert into public.time_entries (
    user_id, created_by, project_id, ticket_id, activity_id,
    minutes, logged_at, start_time, description
  )
  values (
    p_user_id, p_user_id, v_timer.project_id, v_timer.ticket_id, v_timer.activity_id,
    v_minutes, v_logged_at, v_start_time, null
  )
  returning id into v_entry_id;

  delete from public.active_timers where user_id = p_user_id;

  return v_entry_id;
end;
$$;

revoke all on function public.stop_timer(uuid) from public;
grant execute on function public.stop_timer(uuid) to authenticated;
