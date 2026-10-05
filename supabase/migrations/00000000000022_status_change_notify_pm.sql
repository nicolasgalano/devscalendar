-- ─────────────────────────────────────────────────────────────
-- Feature 023 — Notificar al PM primario cuando cambia el status.
--
-- Cambio quirúrgico: `create or replace function notify_ticket_events()`
-- preservando TODAS las ramas anteriores (assignee, status change al assignee,
-- status change al creador — heredadas de 015; menciones en description_doc
-- insert + update — heredadas de 022) y sumando UNA invocación nueva en la
-- rama de status change: al PM primario del proyecto.
--
-- Dedupe explícita en tres direcciones (actor, assignee, creador) para no
-- duplicar la notificación cuando el PM coincide con alguno — que es el caso
-- más común (60-70% de los tickets según cómo se opera).
--
-- Migration aditiva pura. Sin cambios de schema, sin cambios en el trigger
-- (`tickets_notify_events`), sin cambios en `notify_user_for_ticket`,
-- sin cambios en src/lib/notifications/events.ts (reusa el tipo
-- `ticket_status_changed` y su copy).
-- ─────────────────────────────────────────────────────────────

create or replace function public.notify_ticket_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id       uuid := auth.uid();
  mention_ids    uuid[];
  old_mention_ids uuid[];
  target_id      uuid;
  project_pm     uuid;
begin
  if tg_op = 'INSERT' then
    -- Assignee (heredado de la migration 14)
    if new.assignee_id is not null
       and new.assignee_id is distinct from actor_id then
      perform public.notify_user_for_ticket(
        new.assignee_id,
        'ticket_assigned',
        new.id,
        jsonb_build_object(
          'project_id',  new.project_id,
          'title',       new.title,
          'assigned_by', actor_id
        )
      );
    end if;

    -- 022: menciones en description_doc al crear
    if new.description_doc is not null then
      mention_ids := array(select public.extract_mention_user_ids(new.description_doc));
      foreach target_id in array mention_ids loop
        perform public.notify_user_for_ticket(
          target_id,
          'ticket_mentioned',
          new.id,
          jsonb_build_object(
            'ticket_id',  new.id,
            'title',      new.title,
            'project_id', new.project_id,
            'author_id',  actor_id,
            'source',     'description'
          )
        );
      end loop;
    end if;

    return null;
  end if;

  -- ── UPDATE ────────────────────────────────────────────────────────────

  -- Assignee change (heredado)
  if new.assignee_id is distinct from old.assignee_id
     and new.assignee_id is not null
     and new.assignee_id is distinct from actor_id then
    perform public.notify_user_for_ticket(
      new.assignee_id,
      'ticket_assigned',
      new.id,
      jsonb_build_object(
        'project_id',           new.project_id,
        'title',                new.title,
        'assigned_by',          actor_id,
        'previous_assignee_id', old.assignee_id
      )
    );
  end if;

  -- Status change (heredado + NUEVO 023)
  if new.status is distinct from old.status then
    -- Al assignee (heredado)
    if new.assignee_id is not null
       and new.assignee_id is distinct from actor_id then
      perform public.notify_user_for_ticket(
        new.assignee_id,
        'ticket_status_changed',
        new.id,
        jsonb_build_object(
          'project_id',  new.project_id,
          'title',       new.title,
          'from_status', old.status::text,
          'to_status',   new.status::text,
          'changed_by',  actor_id
        )
      );
    end if;

    -- Al creador si no es actor y no es el asignado (heredado, dedup vs assignee)
    if new.created_by is distinct from actor_id
       and new.created_by is distinct from new.assignee_id then
      perform public.notify_user_for_ticket(
        new.created_by,
        'ticket_status_changed',
        new.id,
        jsonb_build_object(
          'project_id',  new.project_id,
          'title',       new.title,
          'from_status', old.status::text,
          'to_status',   new.status::text,
          'changed_by',  actor_id
        )
      );
    end if;

    -- NUEVO 023: al PM primario del proyecto, si no coincide con actor,
    -- assignee o creador (dedupe en tres direcciones — evita duplicar la
    -- fila cuando el PM ya recibió el aviso por otra vía).
    -- notify_user_for_ticket ya filtra self-notify y null, así que el
    -- chequeo acá es solo contra assignee/creador para no duplicar.
    select p.pm_id into project_pm
    from public.projects p
    where p.id = new.project_id;

    if project_pm is not null
       and project_pm is distinct from new.assignee_id
       and project_pm is distinct from new.created_by then
      perform public.notify_user_for_ticket(
        project_pm,
        'ticket_status_changed',
        new.id,
        jsonb_build_object(
          'project_id',  new.project_id,
          'title',       new.title,
          'from_status', old.status::text,
          'to_status',   new.status::text,
          'changed_by',  actor_id
        )
      );
    end if;
  end if;

  -- 022: menciones nuevas en description_doc
  if new.description_doc is distinct from old.description_doc then
    old_mention_ids := coalesce(
      array(select public.extract_mention_user_ids(old.description_doc)),
      array[]::uuid[]
    );
    mention_ids := array(select public.extract_mention_user_ids(new.description_doc));
    foreach target_id in array mention_ids loop
      if not (target_id = any(old_mention_ids)) then
        perform public.notify_user_for_ticket(
          target_id,
          'ticket_mentioned',
          new.id,
          jsonb_build_object(
            'ticket_id',  new.id,
            'title',      new.title,
            'project_id', new.project_id,
            'author_id',  actor_id,
            'source',     'description'
          )
        );
      end if;
    end loop;
  end if;

  return null;
end;
$$;
