-- ─────────────────────────────────────────────────────────────
-- Feature 019 — Editor rich text para descripciones de tickets.
--
-- Suma la columna `description_doc jsonb` a `public.tickets` como fuente de
-- verdad post-019 de la descripción. La columna vieja `description text` se
-- conserva como fallback de lectura para tickets no migrados; su drop llega
-- en una feature aparte (019.5, "fase 2") después de verificar en producción
-- que 100% de los tickets tienen `description_doc` no nulo. La razón es la
-- regla de dos fases del CLAUDE.md: con usuarios en producción, un single-
-- migration que agregue Y borre rompe el deploy anterior en el momento en
-- que corre `db:push`.
--
-- Sin índice: el jsonb se lee siempre junto con el resto de las columnas del
-- ticket y no se filtra por contenido.
--
-- Sin RLS nueva: la policy de tickets no se toca, y el guard positivo del
-- trigger `enforce_ticket_contributor_scope` hereda la protección de esta
-- columna nueva porque compara `to_jsonb(new) - {whitelist}` contra
-- `to_jsonb(old) - {whitelist}` — cualquier columna nueva nace protegida
-- (ADR 0009 aplicado a tickets).
-- ─────────────────────────────────────────────────────────────

alter table public.tickets
  add column description_doc jsonb;

comment on column public.tickets.description_doc is
  'ProseMirror doc (JSON) — fuente de verdad post-019. La columna description '
  'queda como fallback de lectura hasta que fase 2 la borre; escrituras nuevas '
  'van solo a description_doc.';

-- Recordatorio en el catálogo para el próximo lector que agregue otra columna
-- a `tickets` y se pregunte si tiene que tocar el trigger. La respuesta es
-- que NO: la whitelist positiva (`array['status','updated_at']::text[]`) es
-- de lo que no se compara, así que cualquier columna nueva entra automática-
-- mente al chequeo genérico de igualdad y queda protegida contra contributors
-- ajenos. Ver ADR 0009 (bookings) para el mismo patrón en otra tabla.
comment on function public.enforce_ticket_contributor_scope() is
  'Contributor scope guard sobre tickets. El diff genérico `to_jsonb(new) - '
  'whitelist = to_jsonb(old) - whitelist` protege TODA columna nueva de '
  'tickets por herencia: agregar una columna no requiere tocar este trigger. '
  'Ver ADR 0009 y feature 019 §2.3.';

-- ─────────────────────────────────────────────────────────────
-- audit_ticket_events: sumar `description_doc` al bloque de `__changed__`.
--
-- Motivo idéntico al de `description`: el doc puede pesar kilobytes y ensuciar
-- `audit_log.diff` sin aportar información útil (el diff de dos docs largos
-- no es legible en la vista de auditoría). Se reemplaza por el string
-- centinela y quien quiera reconstruir el cambio tiene que ir al ticket o a
-- una versión versionada aparte (no la tenemos hoy).
--
-- Cuerpo base: migration 15 (`fix_ticket_audit_diff`). El único cambio es
-- el bloque `if diff ? 'description_doc'` agregado en paralelo al de
-- `description`. Todo lo demás byte-a-byte.
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

  select coalesce(jsonb_object_agg(key, to_jsonb(new) -> key), '{}'::jsonb)
    into diff
    from jsonb_object_keys(to_jsonb(new)) as t(key)
   where key not in ('status', 'assignee_id', 'updated_at')
     and (to_jsonb(new) -> t.key) is distinct from (to_jsonb(old) -> t.key);

  if diff <> '{}'::jsonb then
    if diff ? 'description' then
      diff := jsonb_set(diff, '{description}', to_jsonb('__changed__'::text));
    end if;
    if diff ? 'description_doc' then
      diff := jsonb_set(diff, '{description_doc}', to_jsonb('__changed__'::text));
    end if;
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values ('ticket', new.id, 'update', actor_id, diff);
  end if;

  return null;
end;
$$;

revoke all on function public.audit_ticket_events() from public;

-- El trigger tickets_audit ya existe (migration 14) y llama a la función por
-- nombre; el create or replace la reemplaza in-place, sin re-crear el
-- trigger.
