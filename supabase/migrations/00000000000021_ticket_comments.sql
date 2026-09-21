-- ─────────────────────────────────────────────────────────────
-- Feature 022 — Comentarios de tickets con @menciones.
--
-- Tabla nueva `ticket_comments` (id, ticket_id, author_id, body_doc jsonb,
-- created_at, updated_at) que guarda cada comentario como un doc ProseMirror
-- rich text validado contra RICH_TEXT_SCHEMA (compartido con la descripción
-- desde 019). Sumamos el nodo `mention` al schema — habilitado tanto en
-- comentarios como en descripciones (decisión de spec/plan).
--
-- Dos tipos nuevos de notificación:
--   - `ticket_mentioned`  → a cada persona con @ en el doc.
--   - `ticket_commented`  → a assignee + creador + PM primario, menos el
--     actor y los ya mencionados (dedupe estricta AC-2.5).
--
-- Un trigger dispara ambas al insertar/actualizar ticket_comments; y el
-- trigger existente notify_ticket_events se extiende para disparar
-- ticket_mentioned también cuando cambian las menciones en tickets.description_doc.
--
-- Migration aditiva pura: tabla nueva, dos check-values nuevas, una función
-- de introspección jsonb nueva, dos triggers nuevos, y notify_ticket_events
-- reemplazada con create-or-replace preservando toda su lógica anterior.
-- Sale con db:push antes del deploy del código de 022 (regla de dos fases).
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- 1. Tabla ticket_comments
-- ─────────────────────────────────────────────────────────────
create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  -- on delete restrict en author_id: un usuario con comentarios no se puede
  -- borrar (se desactiva). La convención del proyecto (CLAUDE.md > Migrations)
  -- para referencias duras a profiles es restrict; leer "por: —" en un
  -- comentario histórico sería peor que forzar el desactivar.
  author_id uuid not null references public.profiles(id) on delete restrict,
  body_doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Patrón de lectura dominante: feed cronológico por ticket.
create index ticket_comments_ticket_id_created_at
  on public.ticket_comments (ticket_id, created_at);

-- Para futuros reportes/cleanup por usuario (no lo consume el MVP).
create index ticket_comments_author_id
  on public.ticket_comments (author_id);

comment on table public.ticket_comments is
  'Comentarios rich text sobre tickets (022). Cada body_doc es un doc '
  'ProseMirror validado aplicativamente contra RICH_TEXT_SCHEMA de 019.';

-- ─────────────────────────────────────────────────────────────
-- 2. RLS + policies + grants
-- ─────────────────────────────────────────────────────────────
alter table public.ticket_comments enable row level security;

-- Read: cualquiera con visibilidad del proyecto del ticket. Viewer basta —
-- no requiere ser contributor (spec AC-1.4/1.5, mismo criterio que Linear).
create policy "ticket_comments: viewer read"
  on public.ticket_comments for select
  to authenticated
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_id
        and public.can_view_project(t.project_id)
    )
  );

-- Insert: cualquiera con visibilidad + el author_id tiene que ser uno mismo.
create policy "ticket_comments: viewer insert"
  on public.ticket_comments for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.tickets t
      where t.id = ticket_id
        and public.can_view_project(t.project_id)
    )
  );

-- Update: SOLO el autor. Editar palabras que otro escribió es inapropiado —
-- si un PM/admin quiere intervenir, borra. Corolario: la policy no restringe
-- QUÉ columnas se pueden cambiar (RLS no distingue columnas — el problema
-- de ADR 0009); el handler solo manda body_doc, así que el vector es
-- aplicativo. Si aparece defense-in-depth necesaria, sumar un guard en
-- trigger análogo al de tickets (F9 de tasks.md).
create policy "ticket_comments: author update"
  on public.ticket_comments for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- Delete: autor, PM primario del proyecto, o admin.
create policy "ticket_comments: author or pm or admin delete"
  on public.ticket_comments for delete
  to authenticated
  using (
    author_id = auth.uid()
    or public.has_role('admin')
    or exists (
      select 1
      from public.tickets t
      join public.projects p on p.id = t.project_id
      where t.id = ticket_id and p.pm_id = auth.uid()
    )
  );

-- Grant DELETE a authenticated: 3ª vez en el proyecto (016 = time_entries,
-- 020 = ticket_attachments, 022 = ticket_comments). Documentado en CLAUDE.md.
grant select, insert, update, delete on public.ticket_comments to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Extender notifications.type con dos tipos nuevos
-- ─────────────────────────────────────────────────────────────
-- Mismo patrón do-block de la migration 14: el check constraint fue definido
-- inline sin nombre explícito, Postgres lo nombró automáticamente; se busca
-- por contenido y se dropea antes de recrear.
do $$
declare
  ctname text;
begin
  select conname into ctname
  from pg_constraint
  where conrelid = 'public.notifications'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%ticket_assigned%';
  if ctname is not null then
    execute format('alter table public.notifications drop constraint %I', ctname);
  end if;
end
$$;

alter table public.notifications
  add constraint notifications_type_check check (type in (
    'booking_created',
    'booking_approved',
    'booking_rejected',
    'booking_cancelled',
    'booking_needs_reapproval',
    'booking_displaced',
    'ticket_assigned',
    'ticket_status_changed',
    'ticket_commented',
    'ticket_mentioned'
  ));

-- ─────────────────────────────────────────────────────────────
-- 4. Funciones de introspección del doc rich text
-- ─────────────────────────────────────────────────────────────
-- extract_mention_user_ids(doc) recorre el árbol jsonb con un CTE recursivo
-- y devuelve los user_id únicos de todos los nodos mention. La regex antes
-- del cast a uuid evita que un doc con basura (que no pasó por el validador
-- Zod — service_role, script one-off) tire 'invalid input syntax'.
--
-- immutable: para el mismo doc devuelve siempre el mismo set. Habilita que
-- Postgres memoice adentro de una misma query.
create or replace function public.extract_mention_user_ids(doc jsonb)
returns setof uuid
language sql
immutable
set search_path = public
as $$
  with recursive walk(node) as (
    select doc
    union all
    select child
    from walk
    cross join lateral jsonb_array_elements(
      coalesce(walk.node -> 'content', '[]'::jsonb)
      || coalesce(walk.node -> 'marks', '[]'::jsonb)
    ) as child
  )
  select distinct (node -> 'attrs' ->> 'user_id')::uuid
  from walk
  where node ->> 'type' = 'mention'
    and node -> 'attrs' ->> 'user_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

comment on function public.extract_mention_user_ids(jsonb) is
  'Recorre un doc ProseMirror y devuelve los user_id únicos de todos los '
  'nodos mention. Regex guard antes del cast a uuid como defensa en '
  'profundidad — el validador Zod ya rechaza esto en el path normal.';

-- Nota: originalmente el plan preveía una función SQL extract_plain_text
-- para guardar un preview truncado en el payload de la notificación (§4.5
-- opción 1 del plan). Se descartó — Postgres no garantiza orden de walker
-- sobre jsonb, así que el "preview" quedaría con las oraciones mezcladas.
-- El preview se computa en TS al dispatchar (src/lib/notifications/events.ts),
-- que ya lee body_doc para armar el email y reusa el mismo walker del
-- validador. Cambio: payload trae ticket_id + comment_id, no plain_text.

-- ─────────────────────────────────────────────────────────────
-- 5. Trigger de notificación de comentarios
-- ─────────────────────────────────────────────────────────────
-- Casos de disparo:
--   INSERT — se dispara ticket_mentioned por cada mencionado (menos actor);
--     después ticket_commented a assignee/creador/PM primario MENOS los ya
--     mencionados y menos el actor (dedupe AC-2.5).
--   UPDATE de body_doc — solo menciones NUEVAS disparan ticket_mentioned.
--     Sacar una mención en una edición NO rescinde el aviso previo (AC-2.7).
--     Y ticket_commented NO se re-emite en edición: el aviso "hay actividad"
--     ya sonó al crear el comentario.
create or replace function public.notify_ticket_comment_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id       uuid := auth.uid();
  ticket_row     record;
  mention_ids    uuid[];
  old_mention_ids uuid[];
  target_id      uuid;
  base_payload   jsonb;
begin
  select t.id, t.title, t.assignee_id, t.created_by, t.project_id, p.pm_id
  into ticket_row
  from public.tickets t
  join public.projects p on p.id = t.project_id
  where t.id = new.ticket_id;

  if tg_op = 'INSERT' then
    base_payload := jsonb_build_object(
      'ticket_id',  ticket_row.id,
      'comment_id', new.id,
      'title',      ticket_row.title,
      'project_id', ticket_row.project_id,
      'author_id',  new.author_id
    );

    -- 1. Menciones
    mention_ids := array(select public.extract_mention_user_ids(new.body_doc));
    foreach target_id in array mention_ids loop
      perform public.notify_user_for_ticket(
        target_id, 'ticket_mentioned', ticket_row.id, base_payload
      );
    end loop;

    -- 2. Stakeholders (menos los ya mencionados; notify_user_for_ticket
    -- filtra al actor y a los null)
    foreach target_id in array array[
      ticket_row.assignee_id,
      ticket_row.created_by,
      ticket_row.pm_id
    ] loop
      if target_id is not null and not (target_id = any(mention_ids)) then
        perform public.notify_user_for_ticket(
          target_id, 'ticket_commented', ticket_row.id, base_payload
        );
      end if;
    end loop;

    return null;
  end if;

  -- ── UPDATE ────────────────────────────────────────────────────────────
  if new.body_doc is distinct from old.body_doc then
    base_payload := jsonb_build_object(
      'ticket_id',  ticket_row.id,
      'comment_id', new.id,
      'title',      ticket_row.title,
      'project_id', ticket_row.project_id,
      'author_id',  new.author_id
    );

    old_mention_ids := coalesce(
      array(select public.extract_mention_user_ids(old.body_doc)),
      array[]::uuid[]
    );
    mention_ids := array(select public.extract_mention_user_ids(new.body_doc));

    foreach target_id in array mention_ids loop
      if not (target_id = any(old_mention_ids)) then
        perform public.notify_user_for_ticket(
          target_id, 'ticket_mentioned', ticket_row.id, base_payload
        );
      end if;
    end loop;
  end if;

  return null;
end;
$$;

revoke all on function public.notify_ticket_comment_events() from public;

create trigger ticket_comments_notify_events
  after insert or update of body_doc on public.ticket_comments
  for each row execute function public.notify_ticket_comment_events();

-- ─────────────────────────────────────────────────────────────
-- 6. Trigger de audit de comentarios
-- ─────────────────────────────────────────────────────────────
-- INSERT: se loguea con actor + ticket_id + author_id (sin body_doc, la
-- fila existe y se recupera si hace falta).
-- UPDATE: si body_doc cambió, marcador '__changed__' (patrón migration 15
-- para audit_ticket_events — sin eso cada edit escribe kilobytes ilegibles).
-- DELETE: snapshot COMPLETO del body_doc (patrón 020) — la fila ya no
-- existe y el audit_log es la única evidencia.
create or replace function public.audit_ticket_comment_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values ('ticket_comment', new.id, 'create', auth.uid(),
      jsonb_build_object(
        'ticket_id', new.ticket_id,
        'author_id', new.author_id
      ));
    return null;
  end if;

  if tg_op = 'UPDATE' then
    if new.body_doc is distinct from old.body_doc then
      insert into public.audit_log (entity, entity_id, action, actor_id, diff)
      values ('ticket_comment', new.id, 'update', auth.uid(),
        jsonb_build_object('body_doc', '__changed__'));
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values ('ticket_comment', old.id, 'delete', auth.uid(),
      jsonb_build_object(
        'ticket_id', old.ticket_id,
        'author_id', old.author_id,
        'body_doc',  old.body_doc
      ));
    return null;
  end if;

  return null;
end;
$$;

revoke all on function public.audit_ticket_comment_events() from public;

create trigger ticket_comments_audit_events
  after insert or update or delete on public.ticket_comments
  for each row execute function public.audit_ticket_comment_events();

-- ─────────────────────────────────────────────────────────────
-- 7. Extender notify_ticket_events para menciones en description_doc
-- ─────────────────────────────────────────────────────────────
-- Preserva TODA la lógica actual (assignee change, status change) y suma
-- dos ramas nuevas:
--   INSERT — si description_doc trae menciones, dispara ticket_mentioned
--     por cada una (payload.source = 'description' para que el copy del
--     email/in-app distinga "en la descripción" vs "en un comentario").
--   UPDATE de description_doc — solo menciones NUEVAS disparan.
--
-- El trigger tiene que escuchar description_doc además de assignee_id y
-- status, así que hay que dropearlo y recrearlo (Postgres no permite
-- alterar la lista de columnas escuchadas).
create or replace function public.notify_ticket_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  mention_ids uuid[];
  old_mention_ids uuid[];
  target_id uuid;
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

    -- NUEVO 022: menciones en description_doc al crear
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

  -- Status change (heredado)
  if new.status is distinct from old.status then
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
  end if;

  -- NUEVO 022: menciones nuevas en description_doc
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

-- Postgres no permite alterar las columnas escuchadas por un trigger:
-- drop + create idempotente.
drop trigger if exists tickets_notify_events on public.tickets;
create trigger tickets_notify_events
  after insert or update of assignee_id, status, description_doc on public.tickets
  for each row execute function public.notify_ticket_events();
