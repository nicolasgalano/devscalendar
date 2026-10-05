# Tasks — Comentarios de tickets con @menciones

- **ID:** 022-ticket-comments-and-mentions
- **Plan reference:** `./plan.md`
- **Spec reference:** `./spec.md`
- **Estado:** draft

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

Fases:

- **Phase 1 — Base: migration + SQL + types** (T1.1 – T1.7)
- **Phase 2 — Editor: nodo `mention`** (T2.1 – T2.7)
- **Phase 3 — API** (T3.1 – T3.6)
- **Phase 4 — UI del feed y del count** (T4.1 – T4.9)
- **Phase 5 — Tests + cierre** (T5.1 – T5.7)

---

## Phase 1 — Base: migration + SQL + types

- [ ] **T1.1** — Migration `supabase/migrations/00000000000021_ticket_comments.sql`, primer bloque:
  - Tabla `ticket_comments` con columnas del §2.1 del plan (id, ticket_id fk cascade, author_id fk restrict, body_doc jsonb, created_at, updated_at).
  - Índices `(ticket_id, created_at)` y `(author_id)`.
  - _DoD:_ el `create table` no falla en la corrida en seco (`supabase db push --dry-run` si lo soporta, o `psql` local si está a mano).

- [ ] **T1.2** — Mismo archivo, segundo bloque: RLS + 4 policies + grants (§2.2 del plan):
  - `enable row level security`.
  - Policy read: `viewer read` con `can_view_project`.
  - Policy insert: `viewer insert` con `author_id = auth.uid()` + `can_view_project`.
  - Policy update: `author update` con `author_id = auth.uid()` en `using` y `with check`.
  - Policy delete: `author or pm or admin delete`.
  - Grant `select, insert, update, delete` a `authenticated`.
  - _DoD:_ el smoke test (T5.1) confirma cada rama.

- [ ] **T1.3** — Mismo archivo, tercer bloque: extender check constraint de `notifications.type` (§2.3 del plan) con `ticket_commented` y `ticket_mentioned`. Reusar el `do $$ ... $$` para dropear el constraint por búsqueda de contenido (patrón de la migration 14).

- [ ] **T1.4** — Mismo archivo, cuarto bloque: funciones SQL:
  - `extract_mention_user_ids(doc jsonb) returns setof uuid` con CTE recursivo + regex guard antes del cast a uuid (§2.4 del plan).
  - `extract_plain_text(doc jsonb) returns text` — junta los `text` de los nodos en orden, con separadores por bloque. Análogo al `plainText` que arma el validador TS. Se usa en `notify_ticket_comment_events` para el preview truncado a 240 chars del payload.
  - `comment on function` en ambas explicando el "por qué" (regex guard, immutable).
  - _DoD:_ dos filas nuevas visibles en `pg_proc` con `select proname from pg_proc where proname like 'extract_%'`.

- [ ] **T1.5** — Mismo archivo, quinto bloque: trigger `notify_ticket_comment_events` (§2.5 del plan):
  - Función `security definer` con dos ramas (INSERT y UPDATE).
  - INSERT: dispara `ticket_mentioned` por cada mencionado; después `ticket_commented` a assignee/creador/PM primario menos los ya mencionados.
  - UPDATE: solo menciones nuevas (diff old vs new) disparan `ticket_mentioned`.
  - Trigger `ticket_comments_notify_events after insert or update of body_doc`.
  - Payload incluye `plain_text` (truncado en el trigger a 240 chars con `substring(... from 1 for 240)`).
  - _DoD:_ cubierto por T5.1 (smoke tests).

- [ ] **T1.6** — Mismo archivo, sexto bloque: trigger `audit_ticket_comment_events` (§2.7 del plan):
  - Función que loguea `create`/`update`/`delete` en `audit_log` con entity = `'ticket_comment'`.
  - En update: `body_doc: '__changed__'` (patrón migration 15).
  - En delete: snapshot completo del `body_doc`.
  - Trigger `after insert or update or delete for each row`.

- [ ] **T1.7** — Mismo archivo, séptimo bloque: `create or replace function public.notify_ticket_events()` extendida (§2.6 del plan):
  - Preservar todas las ramas actuales (assignee, status change).
  - Sumar rama INSERT que dispara `ticket_mentioned` por cada mención del `description_doc` (con `payload.source = 'description'`).
  - Sumar rama UPDATE que dispara `ticket_mentioned` para menciones nuevas del `description_doc`.
  - `drop trigger if exists tickets_notify_events on public.tickets`.
  - `create trigger tickets_notify_events after insert or update of assignee_id, status, description_doc`.
  - _DoD:_ smoke test (T5.1) confirma que un ticket nuevo con mención en descripción dispara `ticket_mentioned`.

- [ ] **T1.8** — `pnpm db:push` a la base cloud + `pnpm db:types` para regen. Verificar que `Database["public"]["Tables"]["ticket_comments"]` esté en `src/types/database.ts`. Commit del `database.ts` regenerado.

---

## Phase 2 — Editor: nodo `mention`

- [ ] **T2.1** — `pnpm add @tiptap/extension-mention @tiptap/suggestion`. Confirmar que `tippy.js` aparece como dep transitiva. Commit del `package.json` + `pnpm-lock.yaml`.

- [ ] **T2.2** — `src/lib/editor/schema.ts`: sumar el nodo `mention` a `RICH_TEXT_SCHEMA.nodes` con attrs `{ user_id, label }` (§3.1 del plan). No tocar `NODES_DISABLED_IN_019` (Q-2 cerró en "también en descripción").

- [ ] **T2.3** — `src/lib/editor/validate.ts`:
  - Sumar `"mention"` a `LEAF_NODES`.
  - Extender el walker para el case `mention`: validar shape de attrs + regex uuid sobre `attrs.user_id` (análogo al chequeo de `href` con protocolos en `link`).
  - _DoD:_ unit test que rechaza `mention` con `user_id` no-uuid, `content` presente, o `attrs.label` faltante (cubierto en T5.3).

- [ ] **T2.4** — `src/lib/editor/render.ts`: sumar case `mention` que emite `<span class="..." data-mention-user-id="...">@Label</span>` con escape de user_id y label (§3.4 del plan). Sin JS, sin link clickeable en el MVP.

- [ ] **T2.5** — `src/lib/editor/tiptap-extensions.ts`: cablear extensión `@tiptap/extension-mention` con `HTMLAttributes` que espeja el renderer server y `renderText({ node }) => '@' + node.attrs.label` para copy/paste como texto plano (§3.2 del plan). Reusar la config para descripción y comentarios (misma instancia).

- [ ] **T2.6** — Nuevo archivo `src/lib/editor/mention-suggestion.ts`: config de `SuggestionOptions`:
  - `items({ query, editor })` → `fetch('/api/projects/{projectId}/members?q=...')` con `editor.storage.projectId`.
  - `render()` que monta `<MentionList>` adentro de un tippy.
  - Debounce de 150 ms.
  - _DoD:_ verificación visual en T5.4.

- [ ] **T2.7** — Nuevo archivo `src/components/tickets/mention-list.tsx` (client): popover con lista de miembros:
  - `up/down/Enter` arrows navigation.
  - Highlight del item activo.
  - Avatar + full_name.
  - Empty state ("Sin miembros que matcheen").
  - Estilos con tokens de `DESIGN.md`.

- [ ] **T2.8** — Nuevo archivo `src/lib/editor/extract-mentions.ts`: helper TS `extractMentionUserIds(doc: ProseMirrorNode | unknown): string[]`. Espeja la lógica del SQL — camina el árbol, recolecta `attrs.user_id` de todos los nodos `mention`, dedupe. Se usa en el handler de la API (§4.2 del plan) para validar contra `project_members`.

---

## Phase 3 — API

- [ ] **T3.1** — Nuevo archivo `src/app/api/projects/[id]/members/route.ts` (GET):
  - Guard `can_view_project(id)`.
  - Query `.rpc()` o `.from('project_members').select('profiles!inner(...)').eq('project_id', id).eq('profiles.active', true)`.
  - Filtro `or('full_name.ilike.%q%,email.ilike.%q%', { referencedTable: 'profiles' })`.
  - `.order('full_name', { referencedTable: 'profiles', ascending: true }).limit(8)`.
  - Response: `{ id, full_name, email, avatar_url }[]`.
  - _DoD:_ endpoint smoke test (T5.2) — viewer del proyecto obtiene resultados; no-miembro recibe 403.

- [ ] **T3.2** — `src/lib/validation/comments.ts`: schema Zod `commentBodySchema = z.object({ body_doc: richTextDocSchema })` para el POST y `commentPatchSchema = commentBodySchema.extend({ expected_updated_at: z.string().datetime() })` para el PATCH. Reusa `richTextDocSchema` de 019.

- [ ] **T3.3** — Nuevo archivo `src/app/api/tickets/[id]/comments/route.ts` (POST):
  - `readJsonBody` + `commentBodySchema.safeParse`.
  - Session check.
  - `extractMentionUserIds(body_doc)` → si hay menciones, query a `project_members` para validar que todos sean miembros activos del proyecto; si algún inválido, response 422 con `{ code: 'mention_target_invalid', user_ids: [...] }`.
  - Insert en `ticket_comments`; capturar código 42501 → 403; otros errores → 500.
  - Response 201 con la fila insertada.
  - _DoD:_ endpoint smoke (T5.2) cubre casos happy path y menciones inválidas.

- [ ] **T3.4** — Nuevo archivo `src/app/api/tickets/[id]/comments/[commentId]/route.ts` (PATCH + DELETE):
  - PATCH: `commentPatchSchema.safeParse`. Chequeo `expected_updated_at` en dos capas (lectura previa + `.eq('updated_at', ...)` en el update). Validación de menciones idéntica al POST. Response 200 o 409 (`stale_update`).
  - DELETE: sin body. RLS decide autorización. Response 204 o 403.
  - _DoD:_ smoke tests (T5.2).

- [ ] **T3.5** — `src/lib/notifications/events.ts`: sumar cases `ticket_commented` y `ticket_mentioned` (§4.5 del plan):
  - `ticket_commented`: subject "Nuevo comentario en {ticket_title}", body con preview de `payload.plain_text` truncado. Link a `/tickets/{key}#comment-{id}`.
  - `ticket_mentioned`: subject "Te mencionaron en {ticket_title}", body ramificado por `payload.source` ("comment" default → link con anchor; "description" → link sin anchor).
  - Actualizar los mapas de tipos + tests unitarios de copy si existen.

- [ ] **T3.6** — `src/lib/notifications/events.ts` (mismo archivo): confirmar que el helper que arma el link usa `NEXT_PUBLIC_SITE_URL` como base para el email. Sin variable → link relativo (patrón 010).

---

## Phase 4 — UI del feed y del count

- [ ] **T4.1** — `src/lib/tickets/query.ts` o el archivo equivalente: extender el fetch del ticket detail con un embed `comments:ticket_comments(...)` **NO** — el fetch de comentarios vive en `<TicketComments>` (server), no en la query global del ticket. Lo único que se extiende acá son las queries de listado (backlog + kanban) para sumar el count por card.

- [ ] **T4.2** — Extender la query del listado de tickets (`getTicketsForProject`, `getTicketsForSprint`, o donde estén) con `comments:ticket_comments(count)` (§5.4 del plan). Mapear a `TicketSummary.commentCount: number`. Cero N+1.

- [ ] **T4.3** — Nuevo archivo `src/components/tickets/ticket-comments.tsx` (server):
  - Fetch de comentarios: `.select('id, body_doc, created_at, updated_at, author:profiles!inner(id, full_name, avatar_url)').eq('ticket_id', ticketId).order('created_at asc').limit(20)`.
  - Render de `<CommentItem>` por cada uno.
  - `<CommentEditor>` al pie.
  - _DoD:_ monta correctamente en el detalle del ticket sin errores de hydration.

- [ ] **T4.4** — Nuevo archivo `src/components/tickets/comment-item.tsx` (server):
  - Render con `dangerouslySetInnerHTML={{ __html: renderDocToHtml(comment.body_doc) }}`.
  - Clase `.ticket-comment` en el wrapper para desactivar checklists interactivas.
  - Header con avatar, nombre, `formatRelative(created_at)`.
  - `<CommentActions>` si `canEdit || canDelete`.
  - _DoD:_ los tres estados de permiso (autor / PM / admin) muestran el kebab correcto.

- [ ] **T4.5** — Nuevo archivo `src/components/tickets/comment-actions.tsx` (client):
  - Kebab con "Editar" (solo si autor) y "Borrar" (con confirm nativo `confirm('¿Borrar este comentario?')`).
  - Modo edición: reemplaza el item por `<CommentEditor initialDoc={...}>` con botones "Guardar" y "Cancelar".
  - PATCH con `expected_updated_at`; en 409 → `router.refresh()` + toast.
  - DELETE con `router.refresh()`.

- [ ] **T4.6** — Nuevo archivo `src/components/tickets/comment-editor.tsx` (client, dynamic import):
  - `useEditor` con `RICH_TEXT_EXTENSIONS`.
  - `editor.storage.projectId = projectId` en `useEffect`.
  - `handleKeyDown`: Cmd/Ctrl+Enter → onSubmit.
  - Botón "Comentar" (o "Guardar" cuando `initialDoc`).
  - `dynamic({ ssr: false })` en el punto de importación (`<TicketComments>` y `<CommentActions>`).
  - _DoD:_ funciona en el navegador tanto para "nuevo comentario" como para "editar".

- [ ] **T4.7** — `src/components/tickets/ticket-detail.tsx`: importar `<TicketComments>` como server component y renderizarlo al final del árbol (después de `<TicketTimeEntries>`). Pasar `ticketId`, `projectId`, `viewer` (session), `isProjectPm` (derivar).

- [ ] **T4.8** — Extender el editor de descripción (`<RichTextEditor>` usado en `<TicketFormDialog>`) para cablear la extensión Mention (§5.5 del plan). Confirmar que `projectId` se pasa como prop y se inyecta en `editor.storage.projectId`. **Punto crítico:** el dialog de "nuevo ticket" también debe tener acceso al projectId (viene del workspace).

- [ ] **T4.9** — Sumar el count de comentarios en la card:
  - `<TicketList>` (backlog): pequeño icon + número al lado del título si `commentCount > 0`.
  - `<KanbanCard>` en `/projects/[key]/board` y `/projects/[key]/sprint`: mismo tratamiento.
  - Ícono: `<MessageCircleIcon>` de `lucide-react` (ya en deps).

---

## Phase 5 — Tests + cierre

- [ ] **T5.1** — Smoke tests SQL en `tests/smoke/ticket-comments.spec.ts`:
  - RLS: viewer del proyecto puede leer/insertar; no-miembro recibe 42501.
  - RLS: autor puede editar; no-autor recibe 42501.
  - RLS: autor / PM primario / admin pueden borrar; contributor de otro no.
  - Trigger `ticket_comments_notify_events` INSERT: `ticket_mentioned` para menciones, `ticket_commented` para assignee/creador/PM (dedupe estricta).
  - Trigger `ticket_comments_notify_events` UPDATE: solo menciones nuevas disparan.
  - Trigger `notify_ticket_events` extendido: al crear ticket con `description_doc` con menciones, cada mencionado recibe `ticket_mentioned` con `source = 'description'`.
  - Trigger de audit: create/update/delete generan las filas esperadas; delete guarda snapshot completo.
  - Check constraint de `notifications.type` acepta los dos tipos nuevos.
  - _DoD:_ todos verdes en CI (`pnpm test:smoke`).

- [ ] **T5.2** — Endpoint smoke tests en `tests/smoke/api-comments.spec.ts`:
  - `GET /api/projects/[id]/members?q=`: viewer obtiene lista, filtro `contains`, cap 8, no-miembro 403.
  - `POST /comments` happy path → 201.
  - `POST /comments` con mención inválida → 422.
  - `PATCH /comments/[id]` happy → 200; con stale `expected_updated_at` → 409.
  - `DELETE /comments/[id]` por autor → 204; por otro → 403.

- [ ] **T5.3** — Unit tests en `tests/unit/editor/`:
  - `validate.test.ts`: acepta doc con `mention` bien formado, rechaza `user_id` no-uuid, rechaza `content` en `mention`, rechaza attrs faltantes.
  - `render.test.ts`: `mention` sale como `<span data-mention-user-id="...">@Label</span>` con escape correcto.
  - `extract-mentions.test.ts`: dado un doc con N menciones (incluyendo dups y nested), devuelve el set único correcto.
  - _DoD:_ `pnpm test:unit` verde.

- [ ] **T5.4** (verificación visual del usuario) — Checklist §11 del plan:
  - [ ] Sección "Comentarios" aparece al pie del detalle.
  - [ ] `@` abre popover con miembros filtrables.
  - [ ] Elegir persona inserta chip.
  - [ ] Rich text (negrita/cursiva/listas/checklist) funciona.
  - [ ] Cmd+Enter publica.
  - [ ] Mencionado recibe email + bandeja con anchor `#comment-<id>`.
  - [ ] PM primario recibe email + bandeja de comentarios que no lo mencionan.
  - [ ] Assignee recibe similar.
  - [ ] Editar un comentario: mención vieja no re-notifica; mención nueva sí.
  - [ ] Borrar comentario: desaparece; aviso viejo queda con anchor roto.
  - [ ] Count aparece en cards del backlog y kanban.
  - [ ] Editar descripción del ticket con `@` nuevo → dispara `ticket_mentioned` con `source=description`.
  - [ ] Un no-miembro del proyecto no puede ver ni comentar (RLS chequeada visualmente).

- [ ] **T5.5** — `specs/features/README.md`: marcar 022 como done (deployed YYYY-MM-DD).

- [ ] **T5.6** — `CLAUDE.md`:
  - Estructura del repo: sumar `src/lib/editor/mention-suggestion.ts`, `src/lib/editor/extract-mentions.ts`, `src/components/tickets/comment-editor.tsx`, `src/components/tickets/ticket-comments.tsx`, `src/components/tickets/comment-item.tsx`, `src/components/tickets/comment-actions.tsx`, `src/components/tickets/mention-list.tsx`.
  - Sección nueva "Ticket comments (022)" bajo "Convenciones de código":
    - Regla de dos fases del schema (el nodo `mention` en `RICH_TEXT_SCHEMA` es la única fuente de verdad — Tiptap, validador Zod y renderer server se sincronizan a partir de ahí).
    - Regla de dos motores de `extract_mentions` (SQL y TS): dos implementaciones que **tienen que dar el mismo resultado**, testeadas por separado. Si aparece divergencia, arreglar las dos.
    - Grant `DELETE` a `authenticated` en `ticket_comments` es la 3ª vez del proyecto (016 = `time_entries`, 020 = `ticket_attachments`, 022 = comments).
  - Estado de features: línea para 022 done.

- [ ] **T5.7** — Merge `feature/022-ticket-comments-and-mentions` → `develop`. Después de aprobado por el user, merge `develop` → `main` (dispara deploy en Vercel).

---

## Blocked / follow-ups

- [ ] **F1 — Paginación completa del feed.** Hoy el MVP muestra los últimos 20 con SSR + botón "Ver anteriores" (que carga más via `?showAll=1` o similar). Cuando aparezca un ticket con 100+ comentarios, decidir si offset o cursor. Cursor con `(created_at, id)` es lo correcto pero es maquinaria; offset con `?before=<created_at>` alcanza.

- [ ] **F2 — Preferencias por-usuario de notificación.** "Silenciar este ticket", "silenciar cambios de status", "solo menciones". Vive en `010` como fase 2 general; sumar `ticket_commented` y `ticket_mentioned` al enum de tipos silenciables cuando exista.

- [ ] **F3 — Threading (respuestas a comentarios).** `parent_id uuid null references ticket_comments(id) on delete cascade`. El feed renderiza árbol. Aditivo — no rompe datos.

- [ ] **F4 — Reacciones (emoji).** Tabla `ticket_comment_reactions (comment_id, user_id, emoji, pk (comment_id, user_id, emoji))`. Sin cambios al comentario.

- [ ] **F5 — Follow explícito del ticket.** Tabla `ticket_watchers (ticket_id, user_id)`. El trigger de `ticket_commented` suma a los watchers. Sin cambios al comment.

- [ ] **F6 — Mostrar "editado el DD/MM" en el comentario.** `updated_at != created_at` en la UI. Un tag `<span className="text-subtle">editado</span>` con tooltip que muestra la fecha. Trivial cuando aparezca el pedido.

- [ ] **F7 — Realtime del feed** (nuevo comentario aparece sin recargar). Supabase Realtime sobre `ticket_comments` filtrado por `ticket_id`. Requiere config extra de realtime + RLS de canales.

- [ ] **F8 — Historial de ediciones visible.** Tabla `ticket_comment_revisions` con snapshot por versión. UI "ver historial" en el kebab del comentario.

- [ ] **F9 — Guard en trigger de update para restringir columnas.** Hoy la policy de update permite cualquier campo (incluido `author_id` en teoría). El handler solo manda `body_doc`, así que el vector es aplicativo. Si aparece la necesidad de defense-in-depth, sumar guard `enforce_ticket_comment_scope` análogo al de tickets (ADR 0009).

- [ ] **F10 — Cap duro de menciones por comentario.** Hoy no hay cap; si aparece spam, límite server-side a 10 mentions únicos.

- [ ] **F11 — Mostrar el PM primario en el autocompletado aunque no esté en `project_members`.** Caso raro heredado de datos viejos. Sumar un `union` en la query del endpoint de miembros o un trigger que auto-sume al PM en el join.

- [ ] **F12 — E2E de la feature.** Un Playwright que abra ticket, comente, mencione, verifique aparición y count. Fuera del MVP (los smoke + unit cubren la lógica).
