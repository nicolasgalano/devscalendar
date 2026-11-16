-- Feature 030 — Time tracker correcciones post-launch
--
-- Dos cambios aditivos que trabajan juntos para resolver el bug del timer
-- olvidado reportado por Emiliano el 2026-11-02:
--
-- 1. Agregar `description` a `active_timers` para que la running card del
--    timer pueda editar la nota en vivo. Nullable; sin backfill — los timers
--    pre-030 arrancan con description = null, comportamiento idéntico al
--    forzado anterior.
--
-- 2. Capear `v_minutes` en `stop_timer` con `least(960, ...)`. El flujo
--    normal del UI avisa al usuario con elapsed humanizado + acciones
--    "Guardar/Descartar y arrancar" antes de llegar a este punto (ver
--    `src/components/time-entries/timer-start-dialog.tsx`). El cap es la
--    red de seguridad para el caso edge: si por algún camino el stop llega
--    con elapsed > 960 min (16 h), se carga un entry de 960 min en vez de
--    hacer explotar la transacción con `23514` sobre
--    `time_entries_minutes_multiple_15`. El nombre del constraint es
--    engañoso — cubre `> 0`, `<= 960` y `% 15 = 0` juntos.
--
-- La migration es aditiva pura y backward-compatible: código viejo que no
-- escribe description sigue funcionando igual (todos los `null`), y el cap
-- solo cambia el comportamiento para elapsed > 960 min (que hoy rompe). Fase
-- 1 de dos-fases ok según CLAUDE.md — no hay drop en una fase 2 posterior
-- (la columna nunca va a desaparecer).

-- 1. Columna description en active_timers ──────────────────────────
alter table public.active_timers add column description text;

-- 2. stop_timer con cap + description ──────────────────────────────
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
begin
  select * into v_timer from public.active_timers where user_id = p_user_id;
  if not found then return null; end if;

  -- Redondeo a múltiplo de 15, mínimo 15, CAP a 960 (16 h). El cap es la red
  -- de seguridad para timers olvidados (feature 030) — el flujo normal avisa
  -- en UI antes de llegar acá. Si llegó, preferimos cargar 16 h en vez de
  -- hacer fallar la transacción con 23514.
  v_minutes := least(
    960,
    greatest(
      15,
      (extract(epoch from (now() - v_timer.started_at)) / 60 / 15)::int * 15
    )
  );

  -- La fecha del entry es la del día local en que se PARÓ, no cuando arrancó.
  -- Un timer que arranca a las 22:00 y se para a las 01:00 crea una entry con
  -- fecha del día siguiente. Es lo intuitivo para el usuario.
  v_logged_at := (now() at time zone 'America/Argentina/Buenos_Aires')::date;

  insert into public.time_entries (
    user_id, created_by, project_id, ticket_id, activity_id,
    minutes, logged_at, description
  )
  values (
    p_user_id, p_user_id, v_timer.project_id, v_timer.ticket_id, v_timer.activity_id,
    v_minutes, v_logged_at, v_timer.description  -- feature 030: antes era null forzado
  )
  returning id into v_entry_id;

  delete from public.active_timers where user_id = p_user_id;

  return v_entry_id;
end;
$$;

-- Los `revoke`/`grant` de la función se mantienen desde la migration 17 — no
-- hace falta repetirlos porque `create or replace` preserva los permisos de
-- la función existente.
