-- ─────────────────────────────────────────────────────────────
-- Fix: audit_ticket_events tira `operator does not exist: jsonb - jsonb`.
--
-- La migration 14 (`015`) usó el operador `-` entre dos valores jsonb para
-- computar la diferencia entre el estado nuevo y el viejo, excluyendo
-- ciertos campos. Ese operador no existe en Postgres: `jsonb - text` y
-- `jsonb - text[]` sí (para remover keys), y `jsonb - int` (para remover
-- índice de array), pero no `jsonb - jsonb`.
--
-- Consecuencia: TODO UPDATE sobre `public.tickets` fallaba, no solo el
-- cambio genérico que la línea intentaba auditar — el trigger corre siempre
-- y la excepción cortaba la transacción entera. Encontrado el 2026-09-16
-- al probar drag & drop en el tablero de `017`.
--
-- No se detectó en CI porque los tests que corrieron cubrían INSERT y
-- lecturas de audit_log post-INSERT, no UPDATE. Anotar como F6 en
-- `015/tasks.md` cuando se cierre esta feature.
--
-- La reparación reemplaza el cálculo por un agregado sobre `jsonb_object_keys`
-- filtrando `where new_val is distinct from old_val`. Preserva la propiedad
-- que motivó el diseño original — que una columna nueva agregada a `tickets`
-- en una feature futura entre automáticamente al audit sin tocar este código.
-- ─────────────────────────────────────────────────────────────

create or replace function public.audit_ticket_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  diff     jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'ticket', new.id, 'create', actor_id,
      jsonb_build_object(
        'project_id',  new.project_id,
        'numero',      new.numero,
        'title',       new.title,
        'priority',    new.priority,
        'assignee_id', new.assignee_id,
        'status',      new.status
      )
    );
    return null;
  end if;

  -- UPDATE: filas específicas para status y assignee (fáciles de consultar
  -- después), más una genérica para el resto.

  if new.status is distinct from old.status then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'ticket', new.id, 'status_change', actor_id,
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'ticket', new.id, 'assignee_change', actor_id,
      jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id)
    );
  end if;

  -- Diff genérico: recorre las keys de `new` (excluyendo status/assignee_id
  -- que ya se auditan aparte, más updated_at que cambia en cada UPDATE por el
  -- trigger de touch), y se queda con las que cambiaron.
  --
  -- Al iterar sobre las keys de `new` en vez de un enum estático, cualquier
  -- columna nueva agregada a `tickets` entra automáticamente al audit — sin
  -- tocar este código. Es la propiedad que la implementación original quería
  -- y que ADR 0009 recomienda para triggers análogos.
  select coalesce(jsonb_object_agg(key, to_jsonb(new) -> key), '{}'::jsonb)
    into diff
    from jsonb_object_keys(to_jsonb(new)) as t(key)
   where key not in ('status', 'assignee_id', 'updated_at')
     and (to_jsonb(new) -> t.key) is distinct from (to_jsonb(old) -> t.key);

  if diff <> '{}'::jsonb then
    if diff ? 'description' then
      diff := jsonb_set(diff, '{description}', to_jsonb('__changed__'::text));
    end if;
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values ('ticket', new.id, 'update', actor_id, diff);
  end if;

  return null;
end;
$$;

revoke all on function public.audit_ticket_events() from public;

-- El trigger ya existe (migration 14, `tickets_audit`) y llama a esta función
-- por nombre, así que no hace falta recrearlo — `create or replace function`
-- reemplaza la implementación in-place.
