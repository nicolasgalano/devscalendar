# Plan — Comentarios de tickets con @menciones

- **ID:** 022-ticket-comments-and-mentions
- **Spec reference:** `./spec.md`
- **Estado:** draft
- **Depende de:** `015-project-membership-and-tickets` (dueño de `tickets`, `project_members`, RLS `can_view_project`, `notify_user_for_ticket`, trigger `notify_ticket_events`). `019-ticket-rich-editor` (dueño de `RICH_TEXT_SCHEMA`, `<RichTextEditor>`, `<RichTextViewer>`, validador Zod, renderer server, extensiones Tiptap). `010-notifications-and-audit` (patrón ADR 0012, `notify_user` con dedupe self-notify, `src/lib/notifications/events.ts` para copy).

---

## 1. Resumen técnico

Feature medianamente grande, cuatro ejes que comparten schema y editor pero se pueden desarrollar en fases secuenciales sin cross-contamination:

1. **Data + notif.** Nueva tabla `ticket_comments` (id, ticket_id, author_id, body_doc jsonb, created_at, updated_at) con RLS (`can_view_project` para read/insert, autor para update, autor + PM primario + admin para delete). Dos nuevos `notification_type`: `ticket_commented` y `ticket_mentioned`. Trigger `notify_ticket_comment_events` que corre `after insert or update` — extrae menciones del `body_doc` con una función SQL nueva (`extract_mention_user_ids(jsonb)`) y llama a `notify_user_for_ticket` para cada mencionado y para assignee/creador/PM primario menos los ya notificados. Trigger de audit con snapshot completo en delete (patrón 020). Grant de `DELETE` a `authenticated` — **tercera vez en el proyecto** tras `016` y `020`; se documenta.

2. **Schema del editor.** Se suma el nodo `mention` a `RICH_TEXT_SCHEMA` con attrs `{ user_id: uuid, label: string }`. Los tres consumidores se actualizan a la vez (regla de 019): Tiptap (extensión `@tiptap/extension-mention` cableada), validador Zod (reconoce el nodo y valida `user_id` como uuid), renderer server (`<span data-mention-user-id="...">@Label</span>`). Como Q-2 cerró en **"habilitado también en descripción"**, `NODES_DISABLED_IN_019` **no** suma `mention` — el nodo queda válido en cualquier doc rich text del sistema (descripción y comentario). Consecuencia: `PATCH /api/tickets/[id]` gana un paso "extraer menciones nuevas del `description_doc` y notificarlas" — lo hace el mismo trigger de tickets, no una segunda pieza aparte.

3. **API.** Tres endpoints REST alineados con el patrón de `attachments`:
   - `POST /api/tickets/[id]/comments`
   - `PATCH /api/tickets/[id]/comments/[commentId]`
   - `DELETE /api/tickets/[id]/comments/[commentId]`

   Más un endpoint dedicado de autocompletado: `GET /api/projects/[id]/members?q=<term>` — devuelve máx 8 miembros activos del proyecto, ordenados por match sobre `full_name`/`email`. Autoriza por `can_view_project`.

4. **UI.** Nueva sección "Comentarios" al pie del detalle del ticket (`ticket-detail.tsx`), servida por SSR. Editor client con Tiptap + extensión Mention cableada al endpoint de autocompletado. Kebab por comentario con Editar / Borrar según permiso. Count de comentarios en las cards del backlog (`<TicketList>`) y del kanban (`<KanbanBoard>`) — vía subquery agregada en la misma query de tickets, no N+1.

### Qs de la spec cerradas en el plan

- **Q-1 · PM primario recibe `ticket_commented`:** **sí**. Alineado con `023`. Se acepta el ruido inicial; preferencias por-usuario quedan como fase 2 de `010`.
- **Q-2 · `mention` habilitado en descripción también:** **sí** (respuesta directa del user antes de escribir el plan). Consecuencia detallada en §5.5.
- **Q-3 · Copy in-app + email:** **cerrado**, cf. §4.3.
- **Q-4 · Anchor `#comment-<id>` en el link del email:** **sí**. Costo cero.
- **Q-5 · Autocompletado con match "contains":** **sí**, `ilike '%q%'` sobre `full_name` y `email`. Ordenado por `full_name asc`, cap de 8.
- **Q-6 · Estilo visual del chip:** **badge inline** con `bg-brand-50 text-brand-800` (tentativo — a resolver en §7.3 con `DESIGN.md`).
- **Q-7 · Lock de sesiones simultáneas:** **no**. `expected_updated_at` en el PATCH alcanza.
- **Q-8 · Realtime del feed:** **no**. Reload manual.
- **Q-9 · Enter vs Cmd/Ctrl+Enter:** **Cmd/Ctrl+Enter publica, Enter = nuevo párrafo**. Patrón Slack/Linear.
- **Q-10 · `edited_at` separado de `updated_at`:** **no**. Con `updated_at != created_at` alcanza.

### Ancla de endpoints en el patrón de 020

Reuso literal:

- `POST /api/tickets/[id]/attachments` → `POST /api/tickets/[id]/comments` (mismo folder pattern).
- `DELETE /api/tickets/[id]/attachments/[attachmentId]` → `DELETE /api/tickets/[id]/comments/[commentId]`.

Sin sorpresas para el próximo lector: si conoce cómo funcionan los attachments, entiende comentarios sin volver a leer.

---

## 2. Modelo de datos

Una migration nueva (número **21**): `00000000000021_ticket_comments.sql`.

### 2.1 Tabla `ticket_comments`

```sql
create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body_doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ticket_comments_ticket_id_created_at
  on public.ticket_comments(ticket_id, created_at);

create index ticket_comments_author_id
  on public.ticket_comments(author_id);
```

**Decisiones:**

- **`ticket_id on delete cascade`:** un comentario sin ticket no significa nada. Los tickets no se borran (se cancelan), pero la consistencia es la misma línea que `notifications.ticket_id` (migration 14).
- **`author_id on delete restrict`:** un usuario con comentarios no se puede borrar. Se desactiva (`active = false`), y sus comentarios siguen. Alineado con la convención del proyecto (referencias duras a `profiles` = `restrict`, blandas = `set null`; el autor es dura porque no tiene sentido leer "por: —").
- **`body_doc jsonb not null`:** siempre presente. La validación es aplicativa (Zod contra `RICH_TEXT_SCHEMA`). No se pone `check` en la base — el trigger de validación jsonb con `json_typeof` etc. sería una copia parcial del validador TS y arrastra deuda.
- **Sin `is_deleted` (soft delete):** los comentarios se borran físicos y quedan en `audit_log` con snapshot. Coherente con `time_entries` (016) y `ticket_attachments` (020).
- **Índices:** el `(ticket_id, created_at)` es el patrón de lectura dominante (feed de un ticket ordenado cronológicamente). El `author_id` es para futuros reportes o cleanup por-usuario. No hay índice sobre `updated_at` — nadie lo consulta.

### 2.2 RLS

```sql
alter table public.ticket_comments enable row level security;

-- Read: cualquiera con visibilidad del proyecto del ticket.
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

-- Insert: cualquiera con visibilidad (viewer basta — spec AC-1.5).
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

-- Update: solo el autor.
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
    or public.has_role(auth.uid(), 'admin')
    or exists (
      select 1 from public.tickets t
      join public.projects p on p.id = t.project_id
      where t.id = ticket_id and p.pm_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.ticket_comments to authenticated;
```

**Decisiones:**

- **`viewer read` y `viewer insert`:** intencionalmente permisivo. Cualquier miembro del proyecto (o admin, vía la RLS `has_any_role` del propio `tickets`) puede comentar. Spec AC-1.5.
- **`author update`:** editar palabras que otro escribió es siempre inapropiado. PM/admin borran, no editan (AC-5.2).
- **Delete cascada de identidad → PM → admin:** el orden importa para lectores humanos; para Postgres el `or` es simétrico.
- **`grant delete`:** tercera vez en el proyecto (016 = `time_entries`, 020 = `ticket_attachments`, 022 = acá). Se documenta en `CLAUDE.md` sección "Convenciones de código > Migrations".
- **La policy de update NO restringe qué columnas se pueden cambiar.** Es el mismo límite que 019/ADR 0009: RLS no distingue columnas. **Un guard opcional en un trigger `before update` puede limitar a `body_doc + updated_at`** — pero como el único otro campo mutable sería `author_id` y no tiene sentido cambiarlo, se acepta no poner el guard y depender de que el handler solo mande `body_doc`. **Cost/benefit:** trigger nuevo por una defensa marginal. Se anota como deuda F si más adelante hace falta.

### 2.3 Extender `notifications.type` check

```sql
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
```

Mismo patrón que la migration 14. Reusa `notify_user_for_ticket` — no hace falta helper nuevo.

### 2.4 Función `extract_mention_user_ids(jsonb)`

```sql
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
    from walk,
      lateral (
        select value from jsonb_array_elements(walk.node->'content')
        where jsonb_typeof(walk.node->'content') = 'array'
        union all
        select value from jsonb_array_elements(walk.node->'marks')
        where jsonb_typeof(walk.node->'marks') = 'array'
      ) as t(child)
  )
  select distinct (node->'attrs'->>'user_id')::uuid
  from walk
  where node->>'type' = 'mention'
    and node->'attrs'->>'user_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

comment on function public.extract_mention_user_ids(jsonb) is
  'Recorre un doc ProseMirror y devuelve los user_id únicos de todos los nodos '
  'mention. La regex asegura que el cast a uuid no explota si el doc trae basura '
  '(defensa en profundidad — el validador Zod ya rechaza esto en el path normal). '
  'immutable porque para un mismo doc devuelve siempre el mismo set — habilita '
  'que Postgres lo memoice adentro de la misma query.';
```

**Decisiones:**

- **CTE recursivo** para caminar el árbol. Postgres 15 lo soporta bien.
- **La regex antes del cast** evita que un doc con basura tire `invalid input syntax for type uuid`. El validador Zod del server ya rechaza esto en el 400, pero el trigger corre después del insert y no puede confiar en que quien insertó pasó por el validador (ej.: script one-off, migración de datos, `service_role`).
- **`immutable`:** determinista para un mismo doc. Habilita que si el trigger la llama dos veces por la misma fila, Postgres puede reusar el resultado.

### 2.5 Trigger `notify_ticket_comment_events`

```sql
create or replace function public.notify_ticket_comment_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  ticket_row record;
  mention_ids uuid[];
  old_mention_ids uuid[];
  new_mention_ids uuid[];
  target_id uuid;
  base_payload jsonb;
begin
  select t.id, t.title, t.assignee_id, t.created_by, t.project_id, p.pm_id
  into ticket_row
  from public.tickets t
  join public.projects p on p.id = t.project_id
  where t.id = new.ticket_id;

  base_payload := jsonb_build_object(
    'ticket_id',  ticket_row.id,
    'comment_id', new.id,
    'title',      ticket_row.title,
    'project_id', ticket_row.project_id,
    'author_id',  new.author_id
  );

  if tg_op = 'INSERT' then
    -- ── 1. Menciones ─────────────────────────────────────────────────────
    mention_ids := array(select public.extract_mention_user_ids(new.body_doc));
    foreach target_id in array mention_ids loop
      perform public.notify_user_for_ticket(
        target_id,
        'ticket_mentioned',
        ticket_row.id,
        base_payload
      );
    end loop;

    -- ── 2. Stakeholders (menos los ya mencionados) ───────────────────────
    -- Regla AC-2.5: si un stakeholder también fue mencionado, recibe solo el
    -- ticket_mentioned. Se saltea acá comparando contra el set de mentions.
    for target_id in
      select unnest(array[
        ticket_row.assignee_id,
        ticket_row.created_by,
        ticket_row.pm_id
      ])
    loop
      if target_id is not null and not (target_id = any(mention_ids)) then
        perform public.notify_user_for_ticket(
          target_id,
          'ticket_commented',
          ticket_row.id,
          base_payload
        );
      end if;
    end loop;

    return null;
  end if;

  -- ── UPDATE ────────────────────────────────────────────────────────────
  -- Sobre menciones: solo las NUEVAS disparan ticket_mentioned (AC-2.7/2.8).
  -- Sacar una mención en una edición NO rescinde el aviso ya enviado.
  -- No se dispara ticket_commented en edición — es un aviso de "hay actividad"
  -- que ya sonó al crear el comentario.
  if new.body_doc is distinct from old.body_doc then
    old_mention_ids := array(select public.extract_mention_user_ids(old.body_doc));
    new_mention_ids := array(select public.extract_mention_user_ids(new.body_doc));

    foreach target_id in array new_mention_ids loop
      if not (target_id = any(old_mention_ids)) then
        perform public.notify_user_for_ticket(
          target_id,
          'ticket_mentioned',
          ticket_row.id,
          base_payload
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
```

**Decisiones:**

- **`security definer`:** el trigger tiene que poder insertar en `notifications` sin depender de la RLS del actor. Mismo patrón que `notify_ticket_events` (migration 14).
- **`after` y no `before`:** cuando corre, `new.id` está definitivo. Y no altera lo que se guardó, coherente con el patrón de otros triggers de notificación.
- **`update of body_doc`:** no dispara si solo cambia `updated_at`. Ojo con el UPDATE que setea `updated_at = now()` sin cambiar `body_doc` — no debería pasar en el path normal, pero es defensivo.
- **Deduplicación auto:** el `not (target_id = any(mention_ids))` cierra AC-2.5. El `notify_user_for_ticket` cierra AC-2.6 (no me avises de lo mío).
- **`ticket_commented` NO se emite en update:** el evento "hay actividad" ya sonó al crear el comentario. Editar es un evento distinto y solo importa a los mencionados nuevos.

### 2.6 Extender `notify_ticket_events` para menciones en descripción

Consecuencia de Q-2 = "también en descripción". El trigger existente (`notify_ticket_events`, migration 14) hoy avisa por assignee y status change. **Se extiende con una tercera rama** que dispara `ticket_mentioned` cuando cambian las menciones en `description_doc`.

**No se toca la migration 14 (nunca se modifica una migration histórica).** Se agrega una nueva migration `21` (la misma que trae `ticket_comments`) que:

```sql
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
    -- [1. assignee (idéntico al que ya está en migration 14)]
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

    -- [1.b. NUEVO: menciones en la descripción al crear]
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

  -- [2. assignee change (idéntico)]
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

  -- [3. status change — misma lógica que hoy; en 023 se extiende con PM primario]
  if new.status is distinct from old.status then
    -- [idem migration 14, sin cambios acá]
    -- ...
  end if;

  -- [3.b. NUEVO: menciones nuevas en description_doc]
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

-- Extender el trigger para escuchar description_doc también
drop trigger if exists tickets_notify_events on public.tickets;
create trigger tickets_notify_events
  after insert or update of assignee_id, status, description_doc on public.tickets
  for each row execute function public.notify_ticket_events();
```

**Decisiones clave:**

- **`payload.source = 'description'`:** distingue la mención "vino de la descripción del ticket" de "vino de un comentario" en la bandeja. La UI del in-app y el copy del email pueden usar `source` para diferenciar el texto ("Te mencionaron en la descripción de {TICKET}" vs "Te mencionaron en un comentario en {TICKET}"). El payload del trigger de comentarios **no** setea `source`, y el frontend lo trata como `'comment'` (default implícito).
- **`ticket_commented` NO se emite en cambios de description_doc.** La descripción no es una conversación — es la definición del ticket. Un cambio de descripción avisa solo a los mencionados nuevos, no a los stakeholders generales.
- **Update del trigger para escuchar `description_doc`:** hay que dropear y recrear el trigger (Postgres no permite alterar la lista de columnas escuchadas). Es idempotente.

### 2.7 Trigger de audit `audit_ticket_comment_events`

```sql
create or replace function public.audit_ticket_comment_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values ('ticket_comment', new.id, 'create', auth.uid(), jsonb_build_object(
      'ticket_id', new.ticket_id,
      'author_id', new.author_id
      -- body_doc omitido por peso; se puede reconstruir del row si hace falta
    ));
    return null;
  end if;

  if tg_op = 'UPDATE' then
    if new.body_doc is distinct from old.body_doc then
      insert into public.audit_log (entity, entity_id, action, actor_id, diff)
      values ('ticket_comment', new.id, 'update', auth.uid(), jsonb_build_object(
        'body_doc', '__changed__'  -- misma convención que audit_ticket_events (migration 15)
      ));
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values ('ticket_comment', old.id, 'delete', auth.uid(), jsonb_build_object(
      'ticket_id', old.ticket_id,
      'author_id', old.author_id,
      'body_doc',  old.body_doc  -- snapshot completo (patrón 020)
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
```

**Decisiones:**

- **En update, `body_doc: '__changed__'`:** patrón heredado de 019 (`audit_ticket_events`, migration 15). Sin eso, cada edición del comentario mete el doc entero al log — kilobytes por evento, ilegible.
- **En delete, snapshot completo:** la fila ya no existe. Patrón 016/020. Es la única evidencia de qué se borró.
- **En insert, `body_doc` omitido:** la fila existe y se puede recuperar. Log más liviano.

---

## 3. Editor: extensión del schema con el nodo `mention`

Regla de 019: **cambiar el schema es cambiar los tres consumidores a la vez.** Sin excepciones.

### 3.1 `src/lib/editor/schema.ts`

Sumar el nodo `mention` al `RICH_TEXT_SCHEMA.nodes`:

```ts
mention: {
  attrs: {
    user_id: { type: "primitive", kind: "string" },  // uuid string, validado más profundo en 3.3
    label: { type: "primitive", kind: "string" },
  },
},
```

**`NODES_DISABLED_IN_019` NO gana `mention`.** Q-2 cerró en "habilitado en descripción también" — el nodo es válido en cualquier doc rich text.

**Sin cambios en `NODES_DISABLED_IN_019`** — sigue conteniendo solo `image` como está (hasta que `020.2` fase 2 lo saque, otra feature).

### 3.2 `src/lib/editor/tiptap-extensions.ts`

Sumar la extensión de Tiptap Mention:

```ts
import Mention from "@tiptap/extension-mention";
import { mentionSuggestion } from "./mention-suggestion";  // archivo nuevo

// dentro del array de extensions:
Mention.configure({
  HTMLAttributes: {
    "data-mention": "",
    class: "inline-flex items-center rounded bg-brand-50 px-1 text-brand-800",
  },
  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
  suggestion: mentionSuggestion,
}),
```

**Nueva dep:** `pnpm add @tiptap/extension-mention @tiptap/suggestion`.

### 3.3 `src/lib/editor/validate.ts`

El validador Zod tiene que aceptar el nodo `mention`. La whitelist positiva del validador ya se apoya en `RICH_TEXT_SCHEMA` — sumar el nodo ahí propaga al validador **automáticamente**, siempre que el walker no tenga un case dedicado a `mention`. Chequear:

- Que el walker de `validate.ts` acepte el nuevo tipo sin código extra (probable — la validación es genérica sobre el schema).
- Que el `user_id` sea uuid válido: el schema declara `type: "primitive", kind: "string"` — no chequea formato uuid. **Sumar un check dedicado** en el validador: si `type === "mention"`, validar `attrs.user_id` con regex uuid. Análogo al chequeo de `href` con protocolos en el `link` mark.
- Que `mention` sea leaf-like: no debe tener `content`. Sumar a `LEAF_NODES` del validador.

**Nada valida acá que el `user_id` sea un usuario real** — es un chequeo aplicativo que corre en el server (§4.2) contra `project_members`. El validador solo garantiza shape.

### 3.4 `src/lib/editor/render.ts`

Sumar case para `mention`:

```ts
case "mention": {
  const userId = escape(node.attrs?.user_id as string);
  const label = escape(node.attrs?.label as string);
  return `<span class="inline-flex items-center rounded bg-brand-50 px-1 text-brand-800" data-mention-user-id="${userId}">@${label}</span>`;
}
```

**Sin JS, sin link clickeable.** El `data-mention-user-id` queda por si alguna fase futura lo consume (tooltip con card del usuario, click a `/admin/users/[id]`). En el MVP es puramente decorativo.

### 3.5 Nuevo archivo `src/lib/editor/mention-suggestion.ts`

Config del popover de autocompletado de Tiptap:

```ts
import type { SuggestionOptions } from "@tiptap/suggestion";
import tippy from "tippy.js";
import { ReactRenderer } from "@tiptap/react";
import { MentionList } from "./mention-list";  // client component

export const mentionSuggestion: Partial<SuggestionOptions> = {
  items: async ({ query, editor }) => {
    // El editor recibe el projectId por props → editor.storage.projectId
    const projectId = editor.storage.projectId as string;
    const res = await fetch(
      `/api/projects/${projectId}/members?q=${encodeURIComponent(query)}`,
      { credentials: "same-origin" },
    );
    if (!res.ok) return [];
    return (await res.json()) as { id: string; full_name: string }[];
  },

  render: () => {
    let component: ReactRenderer;
    let popup: ReturnType<typeof tippy>[number];

    return {
      onStart: (props) => { /* mount MentionList inside tippy */ },
      onUpdate: (props) => { /* update items */ },
      onKeyDown: (props) => { /* forward to MentionList */ },
      onExit: () => { /* cleanup */ },
    };
  },
};
```

**Decisiones:**

- **`editor.storage.projectId`:** el editor recibe el projectId como parte de la config al montarse. Sin projectId no funciona el autocompletado (edge case: comentar antes de que el ticket sepa su project — imposible porque el detalle del ticket ya tiene el proyecto).
- **`tippy.js`:** dep que Tiptap ya trae transitiva (via `@tiptap/suggestion`). Sin sumar deps extras.
- **Debounce de 150 ms:** implementado adentro del `items()` con un `setTimeout` para no matraquear el server. Q-8 cerró en no-realtime, pero el autocompletado sí es interactivo.

### 3.6 `<CommentEditor>` (client)

Nuevo componente `src/components/tickets/comment-editor.tsx`:

```tsx
"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { RICH_TEXT_EXTENSIONS } from "@/lib/editor/tiptap-extensions";

export function CommentEditor({
  projectId,
  onSubmit,
  initialDoc,
}: {
  projectId: string;
  onSubmit: (doc: unknown) => Promise<void>;
  initialDoc?: unknown;
}) {
  const editor = useEditor({
    extensions: RICH_TEXT_EXTENSIONS,
    content: initialDoc ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      handleKeyDown: (view, event) => {
        // Cmd/Ctrl+Enter publica
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          onSubmit(editor?.getJSON());
          return true;
        }
        return false;
      },
    },
  });

  // Inyectar projectId al storage al montar
  useEffect(() => {
    if (editor) editor.storage.projectId = projectId;
  }, [editor, projectId]);

  return (
    <div className="rounded-md border border-subtle bg-surface p-3">
      <EditorContent editor={editor} />
      <div className="flex justify-end pt-2">
        <Button onClick={() => onSubmit(editor?.getJSON())} size="sm">
          Comentar
        </Button>
      </div>
    </div>
  );
}
```

**Se carga con `dynamic({ ssr: false })`** desde `<TicketComments>` (patrón 019 con `<RichTextEditor>`).

**Toolbar:** por decidir en §7 — arranca sin toolbar (rich text vía atajos de teclado, misma UX que Slack), y se suma toolbar completa si aparece pedido. En Linear el editor de comentarios no tiene toolbar y funciona bien.

---

## 4. API

### 4.1 `GET /api/projects/[id]/members?q=<term>`

Nuevo endpoint en `src/app/api/projects/[id]/members/route.ts`:

```ts
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();

  const supabase = await createServerClient();
  const { data: session } = await supabase.auth.getUser();
  if (!session.user) return unauthorized();

  // Autorización: can_view_project
  const { data: canView } = await supabase
    .rpc("can_view_project", { p_project_id: params.id })
    .single();
  if (!canView) return forbidden();

  // Query: miembros activos del proyecto, match sobre full_name/email, cap 8
  const { data, error } = await supabase
    .from("project_members")
    .select("profile:profiles!inner(id, full_name, email, avatar_url, active)")
    .eq("project_id", params.id)
    .eq("profile.active", true)
    .or(
      query
        ? `full_name.ilike.%${query}%,email.ilike.%${query}%`
        : "id.not.is.null",
      { referencedTable: "profiles" },
    )
    .order("full_name", { referencedTable: "profiles", ascending: true })
    .limit(8);

  if (error) return internalError(error);

  return Response.json(
    (data ?? []).map((row) => ({
      id: row.profile.id,
      full_name: row.profile.full_name,
      email: row.profile.email,
      avatar_url: row.profile.avatar_url,
    })),
  );
}
```

**Decisiones:**

- **`can_view_project` como guard:** viewer puede ver la lista → puede mencionar a cualquiera del proyecto.
- **PM primario incluido:** viene en el join si es miembro (todo PM primario se auto-suma como `lead` en el trigger de 015). Si no está en `project_members` — caso raro heredado de datos viejos — no aparece en el autocompletado. **Aceptado como limitación de este endpoint** — si se quiere garantía absoluta, sumar un `union` con el PM primario. Fuera del MVP.
- **`or(...)` filtro:** el `or` de PostgREST sobre columnas embebidas requiere `{ referencedTable: 'profiles' }`. Verificar con un smoke test que la RLS de `project_members` no rebota (Q-5 confirmó "contains", `ilike '%q%'` es la forma).
- **Cap 8:** cabe en el popover sin scroll. Si el usuario tipea algo muy genérico, elige lo que aparece o refina.
- **`avatar_url` en la respuesta:** por si el `<MentionList>` decide mostrar avatar (nice-to-have, no bloquea).

**Autorización de mencionar a alguien que no es miembro:** el endpoint solo lista miembros; el validador del server rechaza `mention.user_id` de un no-miembro (§4.2). Doble garantía.

### 4.2 `POST /api/tickets/[id]/comments`

Nuevo endpoint en `src/app/api/tickets/[id]/comments/route.ts`:

```ts
const bodySchema = z.object({
  body_doc: richTextDocSchema,  // reusa el schema Zod de 019
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await readJsonBody(request);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const supabase = await createServerClient();
  const { data: session } = await supabase.auth.getUser();
  if (!session.user) return unauthorized();

  // Validar menciones: cada user_id del doc tiene que ser miembro activo del proyecto
  const mentionIds = extractMentionUserIds(parsed.data.body_doc);
  if (mentionIds.length > 0) {
    // 1. Encontrar el project_id del ticket
    const { data: ticket } = await supabase
      .from("tickets")
      .select("project_id")
      .eq("id", params.id)
      .single();
    if (!ticket) return notFound();

    // 2. Chequear que todos los mencionados sean miembros activos del proyecto
    const { data: valid } = await supabase
      .from("project_members")
      .select("profile_id, profiles!inner(active)")
      .eq("project_id", ticket.project_id)
      .in("profile_id", mentionIds)
      .eq("profiles.active", true);
    const validIds = new Set((valid ?? []).map((row) => row.profile_id));
    const invalid = mentionIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      return unprocessableEntity({ code: "mention_target_invalid", user_ids: invalid });
    }
  }

  // Insert (la RLS del select fue chequeada implícita al leer el ticket arriba)
  const { data, error } = await supabase
    .from("ticket_comments")
    .insert({
      ticket_id: params.id,
      author_id: session.user.id,
      body_doc: parsed.data.body_doc,
    })
    .select("id, ticket_id, author_id, body_doc, created_at, updated_at")
    .single();

  if (error) {
    if (error.code === "42501") return forbidden();  // RLS reject
    return internalError(error);
  }

  return Response.json(data, { status: 201 });
}
```

**Decisiones:**

- **`extractMentionUserIds`:** helper TS nuevo en `src/lib/editor/extract-mentions.ts`. Espeja la lógica del SQL `extract_mention_user_ids` (caminar el árbol, tomar `attrs.user_id` de todos los `mention`). El plan y el SQL se testean por separado; los dos comparten la semántica.
- **Chequeo de "menciones válidas" en el handler:** doble red — validador de shape (via Zod, garantiza uuid) + validación de negocio (via query a `project_members`). Sin la segunda, un cliente puede mencionar a alguien de otro proyecto (leak de directorio).
- **RLS del insert:** garantía dura de que solo se puede insertar contra tickets del proyecto que ves. Sin ese `can_view_project` en la policy, un usuario podría crear comentarios en tickets de proyectos vecinos con solo saber el ticket id.
- **Response 201 con la fila:** el cliente la usa para pintar el nuevo comentario sin refetch.

### 4.3 `PATCH /api/tickets/[id]/comments/[commentId]`

Nuevo endpoint. Body: `{ body_doc, expected_updated_at }`. Chequeo `expected_updated_at` para evitar la carrera del AC-5.5. Mismo pattern de validación de menciones que el POST.

```ts
const bodySchema = z.object({
  body_doc: richTextDocSchema,
  expected_updated_at: z.string().datetime(),
});

// ... el handler:
const { data: current } = await supabase
  .from("ticket_comments")
  .select("updated_at")
  .eq("id", params.commentId)
  .single();
if (!current) return notFound();
if (current.updated_at !== parsed.data.expected_updated_at) {
  return conflict({ code: "stale_update", current_updated_at: current.updated_at });
}

// Validar menciones (igual que POST)
// ...

// Update con expected_updated_at en el where — cierra la ventana entre lectura y escritura
const { data, error } = await supabase
  .from("ticket_comments")
  .update({ body_doc: parsed.data.body_doc, updated_at: new Date().toISOString() })
  .eq("id", params.commentId)
  .eq("updated_at", parsed.data.expected_updated_at)
  .select("id, body_doc, updated_at")
  .single();

if (!data) return conflict({ code: "stale_update" });  // filtró por updated_at → 0 filas
```

**Nota:** el `.eq("updated_at", ...)` cierra la ventana entre la lectura y la escritura. Mismo patrón que 005 con `expectedUpdatedAt` en bookings y 019 con checklist.

### 4.4 `DELETE /api/tickets/[id]/comments/[commentId]`

```ts
export async function DELETE(request: Request, { params }: { params: { id: string; commentId: string } }) {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("ticket_comments")
    .delete()
    .eq("id", params.commentId);
  if (error) {
    if (error.code === "42501") return forbidden();
    return internalError(error);
  }
  return new Response(null, { status: 204 });
}
```

RLS decide autorización (autor OR PM primario OR admin). Sin chequeo aplicativo extra — la policy tiene el `or` completo.

### 4.5 Copy de notif: `src/lib/notifications/events.ts`

Sumar los dos tipos nuevos. Estructura del archivo (`events.ts`) tiene un mapa `type → { subject, body, url }`. Agregar:

```ts
ticket_commented: (payload, actor) => ({
  subject: `Nuevo comentario en ${payload.title}`,
  body: `${actor.full_name} comentó: "${truncate(extractPlainTextFromPayload(payload), 240)}"`,
  url: `/tickets/${payload.ticket_key}#comment-${payload.comment_id}`,
}),

ticket_mentioned: (payload, actor) => ({
  subject: `Te mencionaron en ${payload.title}`,
  body: payload.source === "description"
    ? `${actor.full_name} te mencionó en la descripción del ticket.`
    : `${actor.full_name} te mencionó en un comentario.`,
  url: payload.source === "description"
    ? `/tickets/${payload.ticket_key}`
    : `/tickets/${payload.ticket_key}#comment-${payload.comment_id}`,
}),
```

**Nota:** `extractPlainTextFromPayload` es un helper que resuelve el problema práctico "cómo saco un preview corto del `body_doc`". Opciones:

1. **El trigger guarda el plainText en el payload al notificar.** Modificar `notify_ticket_comment_events` para pasar `plain_text` en el `base_payload` — computado con `jsonb_path_query` que junte los `text` de los nodos, o con una función `extract_plain_text(doc jsonb)`.
2. **`events.ts` lee `ticket_comments.body_doc` al armar el email.** Requiere segundo query en cada dispatch; poco costo pero no atómico con la creación.
3. **El payload NO trae preview; el email dice "Ver el comentario" sin cita.** Más pobre; funciona.

**Preferencia:** opción **1** — trigger guarda `plain_text` truncado a 240 chars en el payload. Cero costo extra en dispatch, y el payload es completo. Función SQL nueva `extract_plain_text(doc jsonb) returns text` — análoga a `extract_mention_user_ids`.

### 4.6 Bandeja in-app y anchor

`<NotificationsBell>` (ya existe, de 010) muestra el copy in-app basado en el mismo `events.ts`. El link con `#comment-<id>` scrollea automáticamente al abrir la ruta — sin código adicional. Si el comentario fue borrado, el anchor no matchea y el navegador queda arriba del ticket. Aceptado.

---

## 5. UI

### 5.1 `<TicketComments>` (server)

Nuevo componente en `src/components/tickets/ticket-comments.tsx`. Server component — hace el fetch inicial. Se coloca en `ticket-detail.tsx` después de `<TicketTimeEntries>`:

```tsx
export async function TicketComments({
  ticketId,
  projectId,
  viewer,
  isProjectPm,
}: {
  ticketId: string;
  projectId: string;
  viewer: { id: string; roles: string[] };
  isProjectPm: boolean;
}) {
  const supabase = await createServerClient();
  const { data: comments } = await supabase
    .from("ticket_comments")
    .select(`
      id, body_doc, created_at, updated_at,
      author:profiles!inner(id, full_name, avatar_url)
    `)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })
    .limit(20);  // AC-7.2: primeros 20 por SSR, "Ver anteriores" para el resto

  return (
    <section className="pt-6">
      <h2 className="text-section pb-3 font-medium">Comentarios</h2>
      <div className="space-y-3">
        {(comments ?? []).map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            canEdit={c.author.id === viewer.id}
            canDelete={c.author.id === viewer.id || isProjectPm || isAdmin(viewer.roles)}
          />
        ))}
      </div>
      <div className="pt-4">
        <CommentEditor ticketId={ticketId} projectId={projectId} />
      </div>
    </section>
  );
}
```

**Decisiones:**

- **Orden `asc`:** AC-7.1. Coherente con Linear/Slack.
- **Cap de 20:** AC-7.2. **Paginación diferida al plan futuro** (F1 abajo) — el MVP solo muestra los últimos 20; "Ver anteriores" queda como link a `?showAll=1` que refresca la página con `.limit(200)` o similar. Si el ticket tiene 500+ comentarios el problema se soluciona ese día.

### 5.2 `<CommentItem>` (server)

```tsx
export function CommentItem({
  comment,
  canEdit,
  canDelete,
}: {
  comment: TicketComment & { author: { id: string; full_name: string; avatar_url: string | null } };
  canEdit: boolean;
  canDelete: boolean;
}) {
  const html = renderDocToHtml(comment.body_doc as ProseMirrorNode);

  return (
    <article id={`comment-${comment.id}`} className="rounded-md border border-subtle bg-surface p-3">
      <header className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <Avatar url={comment.author.avatar_url} name={comment.author.full_name} size="sm" />
          <span className="font-medium">{comment.author.full_name}</span>
          <span className="text-subtle text-xs">{formatRelative(comment.created_at)}</span>
        </div>
        {(canEdit || canDelete) && (
          <CommentActions
            commentId={comment.id}
            canEdit={canEdit}
            canDelete={canDelete}
            initialDoc={comment.body_doc}
            updatedAt={comment.updated_at}
          />
        )}
      </header>
      <div
        className="rich-text ticket-comment"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
```

**`.ticket-comment` clase para desactivar checklists interactivas** (AC-7.4). En `globals.css`:

```css
.ticket-comment [data-task-item-marker] {
  pointer-events: none;
  opacity: 0.7;
}
```

**El renderer server ya usa el mismo path de 019** — con solo agregar la case `mention` en `render.ts` (§3.4), los comentarios pintan las menciones sin código adicional acá.

### 5.3 `<CommentActions>` (client)

Kebab con Editar / Borrar. Cliente porque necesita `useState` y llamar a `fetch`.

```tsx
"use client";

export function CommentActions({ commentId, canEdit, canDelete, initialDoc, updatedAt }: Props) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();

  if (editing) {
    return (
      <CommentEditor
        initialDoc={initialDoc}
        onSubmit={async (doc) => {
          const res = await fetch(`/api/tickets/${ticketId}/comments/${commentId}`, {
            method: "PATCH",
            body: JSON.stringify({ body_doc: doc, expected_updated_at: updatedAt }),
          });
          if (res.ok) {
            setEditing(false);
            router.refresh();
          } else if (res.status === 409) {
            router.refresh();
            toast.error("Otra pestaña ya editó este comentario. Se refrescó con la última versión.");
          }
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit && <DropdownMenuItem onClick={() => setEditing(true)}>Editar</DropdownMenuItem>}
        {canDelete && (
          <DropdownMenuItem onClick={async () => {
            if (!confirm("¿Borrar este comentario?")) return;
            await fetch(`/api/tickets/${ticketId}/comments/${commentId}`, { method: "DELETE" });
            router.refresh();
          }}>Borrar</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 5.4 Count de comentarios en cards

`<TicketList>` (backlog) y `<KanbanCard>` (sprint + board) tienen queries que traen tickets. Extender el select con un `count`:

```ts
.select(`
  id, key, title, status, priority, assignee_id, ...,
  comments:ticket_comments(count)
`)
```

En PostgREST esto devuelve `[{ count: 3 }]` que el frontend interpreta. El count viaja en la misma query — sin N+1.

Renderizado en la card:

```tsx
{ticket.commentCount > 0 && (
  <span className="inline-flex items-center gap-1 text-subtle text-xs">
    <MessageCircleIcon className="size-3" />
    {ticket.commentCount}
  </span>
)}
```

Cero comentarios: no se muestra (AC-8.1). Sin truncado a "99+" (AC-8.2).

**Impacto en la RLS:** el count respeta la RLS de `ticket_comments`, que es `can_view_project`. Como el usuario que ve la card ya tiene visibilidad del proyecto (RLS de `tickets`), el count refleja el número real. **No hay leak** — un no-miembro no ve la card ni el count.

### 5.5 Rehabilitar `mention` en el editor de descripción (Q-2)

Como Q-2 cerró en "también en descripción", el editor de descripción (`<RichTextEditor>` usado en `<TicketFormDialog>`) tiene que **cablear la extensión Mention** al montarse. El editor recibe `projectId` como prop (ya lo hace hoy vía el ticket que está editando) y lo pasa a `editor.storage.projectId`. **Cero cambios estructurales** — solo asegurar que `Mention` esté en el array `RICH_TEXT_EXTENSIONS` y que el projectId se inyecte.

**Nada bloquea que un ticket nuevo (sin id todavía) tenga menciones** — el projectId es lo único que hace falta para el autocompletado, y el dialog de "nuevo ticket" ya lo tiene (viene del contexto del workspace).

---

## 6. Deps

- `pnpm add @tiptap/extension-mention @tiptap/suggestion` — extensiones oficiales de Tiptap. `tippy.js` viene como dep transitiva de `@tiptap/suggestion`.
- Sin cambios en deps server-side.

---

## 7. Tests

### 7.1 Migration (smoke)

Nuevo archivo `tests/smoke/ticket-comments.spec.ts`. Cubre lo que solo Postgres + PostgREST pueden confirmar:

- RLS: viewer del proyecto puede leer/insertar comentarios; no-miembro no.
- RLS: autor puede editar su comentario; no-autor recibe 42501.
- RLS: autor / PM primario / admin pueden borrar; otros no.
- Trigger `ticket_comments_notify_events` dispara `ticket_mentioned` para cada mencionado del doc.
- Trigger dispara `ticket_commented` para assignee/creador/PM primario menos mencionados.
- Trigger deduplica: mencionar a alguien que también es assignee → una sola notif (`ticket_mentioned`).
- Trigger no auto-notifica al actor.
- Trigger de update: mención nueva dispara `ticket_mentioned`; mención existente no re-dispara.
- Trigger `notify_ticket_events` extendido: al crear un ticket con `description_doc` con menciones, cada mencionado recibe `ticket_mentioned` con `payload.source = 'description'`.
- Trigger de audit: create/update/delete generan la fila esperada. Delete guarda `body_doc` snapshot completo.
- Extensión del check constraint de `notifications.type`: aceptar `ticket_commented` y `ticket_mentioned`; rechazar strings inválidos.

### 7.2 Endpoint smoke

- `POST /comments` con doc válido → 201 y fila persistida.
- `POST /comments` con `mention.user_id` de un no-miembro → 422.
- `PATCH /comments/[id]` con `expected_updated_at` correcto → 200.
- `PATCH /comments/[id]` con stale → 409.
- `DELETE /comments/[id]` como autor → 204.
- `DELETE /comments/[id]` como no-autor/no-PM/no-admin → 403.
- `GET /api/projects/[id]/members?q=` filtra y limita a 8.

### 7.3 Unit

- `src/lib/editor/extract-mentions.ts`: dado un doc con `n` menciones (incluyendo duplicados y nested en marks), devuelve el set correcto de user_ids únicos.
- `src/lib/editor/validate.ts`: acepta doc con nodo `mention` bien formado, rechaza `mention` con `user_id` no-uuid, `content` presente en `mention`, o `attrs` faltantes.
- `src/lib/editor/render.ts`: renderiza `mention` como `<span data-mention-user-id="...">@Label</span>` con el user_id escapado.

### 7.4 E2E (opcional, low priority)

Un test Playwright que:

1. Abre un ticket como viewer del proyecto.
2. Escribe un comentario con `@` y mencionea a alguien.
3. Publica.
4. Verifica que el comentario aparece y el chip de mención es visible.
5. Verifica que el count del card en el kanban aumentó.

**Decisión:** no en el MVP. Los smoke + unit cubren la lógica; E2E es UX puro que se prueba visualmente durante la verificación.

---

## 8. Migrations

- **Nueva:** `supabase/migrations/00000000000021_ticket_comments.sql` con:
  - `create table ticket_comments`.
  - RLS + policies + grants.
  - `alter table notifications` extender check constraint con dos tipos nuevos.
  - `create function extract_mention_user_ids(jsonb)`.
  - `create function extract_plain_text(jsonb)`.
  - `create function notify_ticket_comment_events()` + trigger.
  - `create function audit_ticket_comment_events()` + trigger.
  - `create or replace function notify_ticket_events()` (extendida con description_doc mentions).
  - `drop + create trigger tickets_notify_events` (para escuchar `description_doc`).

- **Regen de types:** `pnpm db:types` después del `db:push`. La nueva tabla y los enums extendidos aparecen en `src/types/database.ts`.

**Regla de dos fases (CLAUDE.md > Migrations):**

- **Agregar** (esta migration): tabla nueva + funciones + triggers + check constraint extendido. **No borra ni renombra nada.** El código deployado sigue funcionando (nadie consulta `ticket_comments` todavía).
- **Deploy** del código UI + API que usa la tabla.
- **No hay fase 2 destructiva** — nada que borrar; la migration ya es aditiva pura.

---

## 9. Riesgos revisitados

R-1 a R-9 de la spec siguen vigentes. Actualización con lo que decidió el plan:

- **R-1 · Explosión de notif** — aceptado, preferencias por-usuario para fase 2.
- **R-2 · Mención a ex-miembro** — el label vive en el JSON, el chip se renderiza. Aceptado. La restricción vive solo al crear/editar (§4.2 chequeo `project_members`).
- **R-3 · Menciones spam** — aceptado. Sin cap duro; si aparece se limita a 10 menciones por comentario en el server.
- **R-4 · Contador lento** — el `count` viaja en la misma query PostgREST del listado. Si en el futuro se hace lento, pasar a `tickets.comment_count int` con trigger. No hoy.
- **R-5 · Race con edición del ticket** — comentarios no updatean `tickets.updated_at`. Sin carrera.
- **R-6 · Schema compartido con descripción** — resuelto por Q-2 = "también en descripción". Cero exclusion list nueva; la lógica de menciones en descripción se hace en el trigger extendido.
- **R-7 · Feed inicial pesado** — cap de 20 iniciales por SSR. "Ver anteriores" queda como F1.
- **R-8 · `mention.user_id` inválido** — doble red: validador Zod (uuid string) + handler (miembro activo del proyecto).
- **R-9 · Notif duplicadas por edición rápida** — trigger compara mentions viejas vs nuevas y solo dispara las nuevas.

**Riesgos nuevos del plan:**

- **R-10 · `extract_mention_user_ids` recursive CTE en Postgres.** El plan de query de un CTE recursivo caminando un jsonb chico (comentarios cortos, ~10 nodos) debería ser trivial. **Mitigación:** benchmark con un doc "extremo" (100 nodos, 20 menciones) — si supera 5 ms de execution time, se cambia a una función plpgsql que use `jsonb_each` iterativo. Improbable pero fácil de mitigar si aparece.
- **R-11 · Trigger extendido de tickets rompe tests de 015/019.** El trigger `notify_ticket_events` gana dos ramas nuevas. Los smoke tests existentes que insertan tickets con `description_doc` con datos raros pueden empezar a disparar notif que no esperaban. **Mitigación:** todos los tests de 015/019 usan tickets con `description_doc = null` o docs simples sin mentions. Verificar antes de mergear; si algún test rompe, ajustarlo.
- **R-12 · La extensión Mention de Tiptap trae CSS/deps que colisionan con nuestros estilos.** `tippy.js` importa un CSS default. **Mitigación:** overridear los estilos del popover con clases Tailwind adentro del `render()` de `mention-suggestion.ts`. Si Tiptap sube versión y la config cambia, F.

---

## 10. Phases

### Phase 1 — Migration + funciones SQL

- 1.1. `00000000000021_ticket_comments.sql` con tabla, RLS, grants.
- 1.2. Extender check constraint de `notifications.type`.
- 1.3. `extract_mention_user_ids(jsonb)` + `extract_plain_text(jsonb)`.
- 1.4. Triggers de audit y notif de comments.
- 1.5. Extender `notify_ticket_events` para menciones en `description_doc`.
- 1.6. `pnpm db:push` (a la base cloud) → `pnpm db:types` → commit.

### Phase 2 — Editor: nodo `mention`

- 2.1. Sumar `mention` a `RICH_TEXT_SCHEMA` (`schema.ts`).
- 2.2. Cablear extensión Tiptap Mention (`tiptap-extensions.ts` + `mention-suggestion.ts` + `<MentionList>` client).
- 2.3. Actualizar validador Zod (`validate.ts`): case `mention`, check uuid, leaf.
- 2.4. Actualizar renderer (`render.ts`): case `mention` → span.
- 2.5. Nuevo helper `src/lib/editor/extract-mentions.ts` (paralelo al SQL).
- 2.6. Unit tests del validador + renderer + extract-mentions.

### Phase 3 — API

- 3.1. `GET /api/projects/[id]/members?q=` — endpoint dedicado (§4.1).
- 3.2. `POST /api/tickets/[id]/comments` (§4.2).
- 3.3. `PATCH /api/tickets/[id]/comments/[commentId]` (§4.3).
- 3.4. `DELETE /api/tickets/[id]/comments/[commentId]` (§4.4).
- 3.5. Sumar `ticket_commented` y `ticket_mentioned` a `src/lib/notifications/events.ts` (§4.5).

### Phase 4 — UI del feed

- 4.1. `<TicketComments>` server (§5.1) e integración en `ticket-detail.tsx`.
- 4.2. `<CommentEditor>` client con dynamic import (§3.6).
- 4.3. `<CommentItem>` server (§5.2).
- 4.4. `<CommentActions>` client (§5.3).
- 4.5. `<MentionList>` client (popover para el autocompletado — parte de §3.5).
- 4.6. Count de comentarios en cards del backlog y kanban (§5.4).
- 4.7. Confirmar que el editor de descripción cablea Mention y pasa `projectId` (§5.5).

### Phase 5 — Tests + verificación + cierre

- 5.1. Smoke tests (RLS + triggers, §7.1).
- 5.2. Endpoint smoke tests (§7.2).
- 5.3. Corrida completa: `pnpm typecheck && pnpm lint && pnpm test:unit`.
- 5.4. Verificación visual manual del usuario (checklist en §11).
- 5.5. Actualizar `CLAUDE.md`:
   - Estructura del repo: `src/lib/editor/mention-suggestion.ts`, `src/lib/editor/extract-mentions.ts`, `src/components/tickets/comment-editor.tsx`, `src/components/tickets/ticket-comments.tsx`, `src/components/tickets/comment-item.tsx`, `src/components/tickets/comment-actions.tsx`, `src/components/tickets/mention-list.tsx`.
   - Sección "Ticket comments (022)" nueva bajo "Convenciones de código", con la regla de dos fases del schema compartido y del extract_mentions.
   - Estado de features → 022 done.
- 5.6. Actualizar `specs/features/README.md` → 022 done (deployed YYYY-MM-DD).
- 5.7. Merge feature/022-ticket-comments-and-mentions → develop → main.
- 5.8. Deploy (Vercel disparado por push a main).

---

## 11. Checklist de verificación visual

Al finalizar Phase 5, el user prueba en producción:

- [ ] Abro un ticket, veo la sección "Comentarios" al pie con editor vacío.
- [ ] Escribo un comentario con `@` — aparece popover con miembros del proyecto; filtra al tipear.
- [ ] Elijo una persona; queda como chip inline con el color del sistema.
- [ ] Uso negrita, cursiva, lista y checklist — el editor los soporta.
- [ ] Publico con Cmd+Enter — aparece arriba del editor, se limpia.
- [ ] La persona mencionada recibe email + aparece en su bandeja in-app; el link lleva a `#comment-<id>` con scroll al comentario.
- [ ] El PM primario del proyecto recibe email + bandeja de un comentario que no lo menciona explícitamente.
- [ ] El assignee del ticket también recibe (o solo el `ticket_mentioned` si además fue mencionado).
- [ ] Edito mi comentario — la mención vieja no dispara notif de nuevo; sumar una nueva mención sí dispara.
- [ ] Borro un comentario — desaparece; el aviso viejo sigue en la bandeja (con "ver comentario" que ya no lleva a nada).
- [ ] En el backlog y en el kanban, las cards con comentarios muestran el count.
- [ ] Abro el diálogo de "Editar ticket" y edito la descripción sumando un `@` — el mencionado nuevo recibe `ticket_mentioned` con source = "description".
- [ ] Verificación de RLS: un usuario que no es miembro del proyecto no puede leer ni comentar (chequeado en el smoke, confirmar en la UI que el ticket ni carga).
