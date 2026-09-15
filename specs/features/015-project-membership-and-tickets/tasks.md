# Tasks — Membresía por proyecto y tickets

- **ID:** 015-project-membership-and-tickets
- **Plan reference:** `./plan.md`
- **Status:** ready

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

> **Antes de escribir una línea, leer `plan.md` §4 y §5.** Cuatro reglas que se rompen con la primera distracción y que hacen fallar la RLS **en silencio**:
>
> 1. La granularidad fina del `contributor` (edita propios, transiciona cualquiera, no reasigna) **vive en un trigger, no en la policy** (§5.4, ADR 0009). Cualquier intento de expresarla en `with check` es papelera.
> 2. La numeración `PROJ-N` se serializa con el `update ... returning` sobre la fila de `projects` (§5.1). No es un `sequence`, no es un `count(*)+1`, no es un `max(numero)+1`. Si aparece la tentación, releer §11.
> 3. El detalle de un ticket que no puedo ver responde **`404`, no `403`** (AC-6.1 del spec, R-4 del plan). La API hace `select` primero y traduce; no confía en el errcode de PostgREST.
> 4. Cambiar `projects.key` en un proyecto con tickets **rompe referencias externas** (Slack, commits, mensajes). El trigger `enforce_project_key_immutable` es la única defensa dura — no se saltea "porque el admin sabe lo que hace".

> **La migration es aditiva pero larga.** Se aplica en un solo `db:push` con el orden interno de `plan.md` §13. Después de 2026-09-08 la base tiene datos reales: la migration tiene que quedar verde en CI (integración + smoke) antes de tocar producción. Regla del CLAUDE.md, sección "Migrations".

---

## Phase 1 — Database

Una migration `YYYYMMDDHHMMSS_015_project_membership_and_tickets.sql` con el orden interno de `plan.md` §13. Cada task es una sección adentro del mismo archivo.

- [ ] **T1.1** — Enums `project_member_role` (`viewer | contributor | lead`), `ticket_status` (`todo | in_progress | in_review | blocked | done | cancelled`) y `ticket_priority` (`low | medium | high | critical`). _DoD: `\dT+` en psql lista los tres._
- [ ] **T1.2** — Extensión de `projects`: agregar `key varchar(8)` nullable y `next_ticket_number int not null default 1`. Backfill del `key` con el `regexp_replace` de `plan.md` §3.2 (fallback `'PROJ'`). Después del backfill, `set not null`, check `~ '^[A-Z][A-Z0-9]{1,7}$'` y `unique`. _DoD: query pre-flight de `plan.md` R-2 devuelve 0 filas en el proyecto de Supabase antes de correr — anotado en la PR._
- [ ] **T1.3** — Tabla `project_members` según `plan.md` §3.3: PK uuid, FKs (`project_id` cascade, `user_id` restrict), unique `(project_id, user_id)`, dos índices parciales `where active = true`. _DoD: `\d project_members` muestra los dos índices y las dos FKs con su `on delete`._
- [ ] **T1.4** — Tabla `tickets` según `plan.md` §3.4: FK `project_id restrict`, `created_by restrict`, `assignee_id set null`. Check de `title` (1–200), unique `(project_id, numero)`. Tres índices (compuesto `project_id/status/updated_at desc`, parcial `assignee_id`, `created_by`). _DoD: `\d tickets` refleja los tres `on delete` y la unique._
- [ ] **T1.5** — Cuatro helpers `security definer` con `set search_path = public` (`plan.md` §4.2): `is_project_member`, `role_in_project`, `is_pm_of_project`, `can_view_project`. Cada uno hace join contra `profiles` para exigir `active = true` **adentro** — regla D-01. _DoD: T5.2 (integración) verifica que un usuario inactivo con fila en `project_members` devuelve `false`._
- [ ] **T1.6** — Grants: `select, insert, update on project_members, tickets to authenticated`. **Nada de `delete`.** Sin grants explícitos la policy deniega en silencio (CLAUDE.md §Migrations). _DoD: `\dp project_members tickets` no lista `delete` para `authenticated`._
- [ ] **T1.7** — Policies RLS de `project_members` (`plan.md` §4.3): read para todo el que ve el proyecto, insert/update solo admin o PM del proyecto. _DoD: T5.2._
- [ ] **T1.8** — Policies RLS de `tickets` (`plan.md` §4.4): select para miembros, insert `contributor+` **con `estado != 'inactivo'` en el `with check`** (patrón D-08), update `contributor+` (la granularidad fina la hace el trigger de T1.11). _DoD: T5.2._
- [ ] **T1.9** — Trigger de numeración `assign_ticket_number` (`plan.md` §5.1). `before insert`, `when (new.numero is null)` para no pisar seeds. El lock de fila sobre `projects` lo hace el `update ... returning`. _DoD: T5.2 corre 20 inserts paralelos y verifica `{1..20}` sin gaps._
- [ ] **T1.10** — Trigger `autoadd_pm_as_lead` (`plan.md` §5.2): promueve al entrante, degrada al saliente (D-6). `after insert or update of pm_id`. Backfill `insert ... on conflict do nothing` para proyectos ya existentes (Q-7). _DoD: T5.2 verifica los dos casos, más idempotencia del backfill._
- [ ] **T1.11** — Trigger `enforce_project_key_immutable` (`plan.md` §5.3). Falla con `check_violation` y `hint` cuando ya hay tickets. _DoD: T5.2._
- [ ] **T1.12** — Trigger `enforce_ticket_contributor_scope` (`plan.md` §5.4). Análogo a ADR 0009 en bookings: la whitelist es **implícita** (`to_jsonb(new) - {'status','updated_at'} = to_jsonb(old) - ...`), así que cualquier columna nueva nace protegida. `service_role`, admin y PM del proyecto pasan sin chequeo. _DoD: T5.2 cubre viewer, contributor propio, contributor ajeno solo status, contributor reasignando (rechazado), lead editando cualquiera._
- [ ] **T1.13** — Trigger `notify_ticket_events` (`plan.md` §5.5). Dos eventos: `ticket_assigned` en insert y en update de `assignee_id`; `ticket_status_changed` en update de `status` — al asignado **y** al creador si son distintos entre sí y del actor. _DoD: T5.2 verifica que reasignarme a mí mismo con cambio de status no dispara dos notificaciones al mismo target (R-5)._
- [ ] **T1.14** — Trigger `audit_ticket_events` (`plan.md` §5.6): filas específicas para `status_changed` y `assignee_changed`, más una genérica `ticket_updated` con diff jsonb. `description` viaja como `"__changed__"`, nunca el contenido (R-7). Agregar también auditoría análoga para `project_members` (create / role_changed / deactivated). _DoD: T5.2 cuenta las filas esperadas y verifica que `description` no aparece con su contenido._
- [ ] **T1.15** — `pnpm db:push` contra el proyecto de Supabase enlazado, luego `pnpm db:types` y `git diff --stat src/types/database.ts`. Comparar CRLF/LF (patrón `006` T1.4). _DoD: `db:types` sin drift; `git status` limpio salvo `database.ts` esperado._

## Phase 2 — Auth y validación

- [ ] **T2.1** — Zod schemas en `src/lib/validation/tickets.ts` (`plan.md` §7.2): `createTicketSchema`, `updateTicketSchema` (partial + refine no-vacío), `createMemberSchema`, `updateMemberSchema`. `description` tope 10 000 chars. _DoD: unit test con casos límite (title vacío, description gigante, priority inválida, assignee_id no-uuid)._
- [ ] **T2.2** — `requireProjectMembership(projectId, minRole)` en `src/lib/api/require-project-membership.ts` (`plan.md` §7.3). Traduce a `NotFoundError` / `UnauthorizedError` / `ForbiddenError` según el patrón de `requireAdmin` / `requireBookingAccess`. **Regla crítica**: si el proyecto no existe → `NotFoundError`, no `ForbiddenError` (AC-6.1). _DoD: T5.1._
- [ ] **T2.3** — `requireTicketAccess(ticketId)` en `src/lib/api/require-ticket-access.ts`: hace `select` del ticket + proyecto, y de ahí delega a `requireProjectMembership`. Si el `select` devuelve `null`, `NotFoundError`. _DoD: T5.1 y T5.4 (E2E de 404)._

## Phase 3 — Dominio del cliente

- [ ] **T3.1** — `parseTicketKey` / `formatTicketKey` en `src/lib/tickets/keys.ts`. Regex `^[A-Z][A-Z0-9]{1,7}-\d+$`. Case-insensitive en el parser (`'wdw-42'` funciona), formato canónico en el output. _DoD: T5.1._
- [ ] **T3.2** — `canEditTicket(profile, ticket, project)` en `src/lib/tickets/permissions.ts`: replica la lógica del trigger de T1.12 en el cliente para UX (deshabilitar controles), **no** para autorización. La verdad la tiene el server. _DoD: T5.1 cubre cada rol con cada operación (status only, edit propio, edit ajeno, reassign) y el resultado coincide con el trigger._
- [ ] **T3.3** — `TICKET_STATUS_ORDER`, `TICKET_STATUS_LABELS`, `TICKET_PRIORITY_LABELS` en `src/lib/tickets/status.ts`. Copy en español según `DESIGN.md`. Colores/badges se resuelven en los componentes.
- [ ] **T3.4** — `parseTicketFilters(searchParams)` / `buildTicketsHref(...)` en `src/lib/tickets/url.ts`. Patrón de `src/lib/calendar/url.ts`: nunca tira, defaults implícitos no se escriben en la URL, valores mal formados caen a defaults. Filtros: `projectId`, `status[]`, `assigneeId` (con alias `me` / `unassigned`), `priority[]`, `q`, `includeClosed`. _DoD: T5.1._
- [ ] **T3.5** — `getTicketsList({ filters })` y `getTicketByKey(key)` en `src/lib/tickets/query.ts`. Server-side, cachear con `cache()` de React. `getTicketByKey` **devuelve `null` en vez de tirar** cuando el ticket no existe o no es visible por RLS — la page traduce a 404. _DoD: T5.3 (smoke)._

## Phase 4 — Notificaciones

- [ ] **T4.1** — Agregar `ticket_assigned` y `ticket_status_changed` a `src/lib/notifications/events.ts` (`plan.md` §6). Los payloads guardan hechos (IDs, status crudos, actor); el copy vive en el builder — cambia sin migration (ADR 0012).
- [ ] **T4.2** — El sender (`src/lib/notifications/dispatch.ts` o donde viva hoy la resolución de `ctx`) tiene que armar `ticketKey` con un join a `projects.key` + `tickets.numero`. **No lo hace el trigger** — el trigger solo guarda IDs. _DoD: T5.2 valida el copy resultante con un mock del sender._
- [ ] **T4.3** — Email templates (subject + HTML minimalista, patrón `010`). Sin `RESEND_API_KEY` las filas quedan `pending` y no rompe nada (CLAUDE.md §Notificaciones). _DoD: manual — mandar uno de prueba a tu propio email si la key está._

## Phase 5 — API

- [ ] **T5.1** — `POST /api/tickets` con `readJsonBody` + `createTicketSchema` + `requireProjectMembership(body.project_id, 'contributor')`. `assignee_id` validado contra `is_project_member` (AC-2.3 del spec) — el chequeo lo puede hacer el mismo handler antes de insertar, o dejar que el `check` del insert la rechace y traducir el error. Preferir el chequeo explícito para el mensaje. Responde `201 { ticket, key }`. _DoD: T7.3 (integración) verifica los 200/400/403/409 esperados._
- [ ] **T5.2** — `PATCH /api/tickets/:id` con `updateTicketSchema` + `requireTicketAccess(id)`. Traduce los errores del trigger contributor-scope (`check_violation` con `hint`) a `403` con `reason`. Traduce ausencia del ticket a `404` (AC-6.1). _DoD: T7.3._
- [ ] **T5.3** — `POST /api/project-members` con `createMemberSchema` + `requireProjectMembership(body.project_id, 'pm')` (o admin). _DoD: T7.3._
- [ ] **T5.4** — `PATCH /api/project-members/:id` con `updateMemberSchema`. Deriva el `projectId` del member antes de pedir el guard. _DoD: T7.3._

## Phase 6 — Markdown

- [ ] **T6.1** — Deps: `pnpm add react-markdown remark-gfm rehype-sanitize`. Verificar bundle: son ~30–40 kB gz sumadas; si es más, revisar. _DoD: `pnpm build` OK, bundle report sin sorpresas._
- [ ] **T6.2** — Schema de `rehype-sanitize` en `src/lib/markdown/sanitize.ts` según whitelist de `plan.md` §8.1. Deny explícito de imágenes, iframes, `html` crudo, `on*`, `style`, `class`, schemes distintos a `http/https/mailto`. _DoD: T7.1 (unit) cubre `<script>`, `<iframe>`, `javascript:` URLs, `<img>`, atributos peligrosos._
- [ ] **T6.3** — `<MarkdownViewer content />` en `src/lib/markdown/viewer.tsx`. Server-safe (sin `"use client"`). Empty state italicizado "Sin descripción". _DoD: manual, con contenidos de `plan.md` §8.1._
- [ ] **T6.4** — `<MarkdownEditor value onChange placeholder maxLength />` en `src/lib/markdown/editor.tsx`. `"use client"`, `<Tabs>` de shadcn con "Escribir" y "Vista previa", mini-toolbar de tres botones (`bold`, `italic`, `link`) que insertan sintaxis en el textarea. _DoD: manual — tipear un ticket real desde el dialog._

## Phase 7 — UI: tickets

- [ ] **T7.1** — Ítem "Tickets" en `AppShell` (ícono `Ticket` de Lucide), a la altura de "Calendario" y "Bandeja". Visible para cualquier rol autenticado — quien no tenga proyectos ve el empty state.
- [ ] **T7.2** — `/tickets/page.tsx` server component. Filtros vía search params, query con `getTicketsList`. Empty state doble (con filtros vs. sin filtros/sin membresías) según `plan.md` §8.2. Loading + error. _DoD: `DESIGN.md` checklist._
- [ ] **T7.3** — `<TicketList />` en `src/components/tickets/`. Tabla con columnas `Key | Título | Estado | Prioridad | Asignado | Actualizado`. `updated_at` renderizado con `formatDistanceToNow`. Fila clickeable → `/tickets/:key`.
- [ ] **T7.4** — `<TicketListFilters />` (client). Cada control es un `<Link>` que reconstruye el href con `buildTicketsHref`. Toggle "Incluir cerrados" análogo al de `014`. Chip visible por cada filtro activo con "quitar". _DoD: manual — cambiar cada filtro y confirmar que la URL refleja y el back button funciona._
- [ ] **T7.5** — `/tickets/[key]/page.tsx` server component. Fetch con `getTicketByKey`; si `null`, `notFound()` (que responde 404). Layout de `plan.md` §8.3. Botón "Editar" solo si `canEditTicket(profile, ticket, project)`. _DoD: T8.4 (E2E)._
- [ ] **T7.6** — `<TicketDetail />`: encabezado con `KEY · título`, meta (cliente, proyecto, creado por, hace X), controles inline de estado/prioridad/asignado (dispatch de `PATCH` optimista), `<MarkdownViewer />` para descripción.
- [ ] **T7.7** — `<TicketFormDialog mode="create" | "edit" />` reusado desde el CTA "+ Nuevo ticket" y desde "Editar". Preselecciona proyecto si el usuario viene desde `?projectId=`. `<TicketAssigneeSelect />` filtra a miembros activos del proyecto. _DoD: manual — crear y editar tickets reales._
- [ ] **T7.8** — Badges `<TicketStatusBadge />` y `<TicketPriorityBadge />` según `DESIGN.md`. Colores tomados de tokens ya existentes; sin agregar tokens nuevos.

## Phase 8 — UI: /admin/projects/:id

- [ ] **T8.1** — Input `key` en el form de alta y edición de proyecto (`src/app/(app)/admin/projects/...`). En **alta**: obligatorio, con sugerencia derivada del nombre igual que el backfill del backend. En **edición**: deshabilitado si el proyecto tiene tickets, con tooltip explicando por qué (trigger de T1.11). _DoD: T8.4 verifica que un admin no puede cambiar `key` con tickets existentes._
- [ ] **T8.2** — `<ProjectMembersPanel projectId />` en `src/components/tickets/`. Server-fetch de miembros activos e inactivos; client-actions para agregar / cambiar rol / desactivar. Badge `(PM)` en la fila del `pm_id`; su toggle "Activo" queda deshabilitado (protección UI — el service_role sí puede, no queremos hostigar al admin con confirmaciones dobles). _DoD: manual._
- [ ] **T8.3** — Guard del panel: visible solo si `isAdmin(profile) || project.pm_id === profile.id`. En otras conversaciones, el server component se renderiza sin el panel. _DoD: manual — abrir `/admin/projects/:id` como developer y confirmar que el panel no aparece._

## Phase 9 — Tests

- [ ] **T9.1** — Unit sin DB:
  - `parseTicketKey` / `formatTicketKey` con casos válidos e inválidos.
  - `canEditTicket` con cada combinación de rol/relación.
  - `parseTicketFilters` con params bien y mal formados; ninguno tira.
  - `sanitize` markdown con payloads maliciosos (`<script>`, `<iframe>`, `javascript:`, atributos `on*`).
  - Zod: `createTicketSchema` y `updateTicketSchema` con casos límite.
- [ ] **T9.2** — Integración (DB) — el corazón de la feature. Un test por regla:
  - **Numeración**: 20 `insert` en paralelo al mismo proyecto → `{1..20}` sin gaps ni duplicados (R-1).
  - **Auto-add PM**: crear un proyecto con `pm_id` → aparece fila `lead`. Cambiar `pm_id` → entrante `lead`, saliente `contributor` (D-6).
  - **Backfill de members**: correr el `insert ... on conflict do nothing` dos veces es idempotente.
  - **Key immutable**: `update projects set key = ...` en proyecto con tickets tira `check_violation`.
  - **Helpers**: `is_project_member` / `role_in_project` / `is_pm_of_project` devuelven `false`/`null` para usuarios inactivos aunque tengan fila (D-01).
  - **Contributor scope**: puede transicionar status ajeno; no puede reasignar; puede editar propios; no puede editar ajenos.
  - **Viewer**: `select` sí; `insert`/`update` denegado por policy.
  - **No-miembro**: `select` de ticket ajeno devuelve 0 filas (silencioso, no error).
  - **Proyecto inactivo**: bloquea `insert` de ticket, permite `update` de existentes (patrón D-08).
  - **Audit**: create + status_change + assignee_change + updated (con `description = "__changed__"`) escriben las filas esperadas.
  - **Notificaciones**: assign + status_change disparan las filas correctas; el actor no se avisa a sí mismo; reasignarme + cambiar status en una request no manda dos notificaciones al mismo target (R-5).
- [ ] **T9.3** — Smoke (PostgREST):
  - `select` de `tickets` con `?project_id=eq.<X>&status=in.(...)&order=updated_at.desc`.
  - `select` con `?title=ilike.%foo%`.
  - `select` de `project_members` con `?project_id=eq.<X>&active=eq.true`.
- [ ] **T9.4** — E2E (Playwright), el flujo que justifica la feature:
  - Admin crea proyecto con `key = 'WDW'` → verifica que `/admin/projects/:id` muestra al PM en Miembros con `lead`.
  - PM invita a Emi como `contributor` → Emi entra a `/tickets` y ve el proyecto; no ve proyectos ajenos.
  - Emi crea `WDW-1` con asignado = PM → PM ve la campana con el aviso.
  - PM cambia el status a `in_progress` → Emi ve la campana.
  - **Crítico** (AC-6.1): un tercer usuario sin membresía pide `/tickets/WDW-1` → responde **404**, no 403.
  - Admin cambia `key` en un proyecto sin tickets → OK. Agrega ticket. Intenta cambiar `key` → error visible.

## Phase 10 — Cierre

- [ ] **T10.1** — Actualizar `specs/features/README.md`: agregar `015` como done con una línea que resuma qué salió (tabla `project_members`, tabla `tickets`, RLS por membresía, `PROJ-N` inmutable, notificaciones de assign y status change, editor de markdown).
- [ ] **T10.2** — Actualizar `CLAUDE.md`:
  - Sección **"Estado de features"**: agregar `015` con el mismo resumen que arriba.
  - Nueva sección **"Tickets y membresía"** dentro de "Convenciones de código", con las cuatro reglas del blockquote inicial de este archivo (contributor scope en trigger, numeración con lock, 404-no-403, `key` inmutable con tickets). Cortas — una línea por regla como el resto.
  - Extender **"Notificaciones"** listando `ticket_assigned` y `ticket_status_changed`.
- [ ] **T10.3** — Actualizar el `spec.md` y el `plan.md` de `016-time-tracking` con la nota **R-3 del plan** (una migration que agregue columna a `tickets` puede romper la respuesta del contributor). Si `016` aún no tiene `spec.md`/`plan.md` escrita, dejar un TODO explícito en el `README.md` de features para no perderlo.
- [ ] **T10.4** — Verificación visual del usuario en el navegador (regla del proyecto, `014` T3.3): crear un proyecto de prueba con `[test:<runId>]`, invitar a otro usuario, crear tickets, verificar avisos, y limpiar con `node scripts/cleanup-test-data.mjs --run-id=<id>`.

---

## Blocked / follow-ups

- [ ] **F1** — **Historial visible en el detalle de ticket.** `audit_log` guarda todos los eventos (T1.14) pero renderizarlos en `/tickets/:key` queda para follow-up (`plan.md` §8.3). Si el scope aprieta se corta; si sobra tiempo se resuelve.
- [ ] **F2** — **Comentarios, attachments, labels, subtareas, sprints, watchers.** Fase 2. `spec.md` §5 los declara fuera; no se modela hasta que aparezca la necesidad concreta.
- [ ] **F3** — **Rol `staff`.** Corresponde a `016-time-tracking` (habilita cargar horas sin ser dev). Agregarlo en `015` sería adelantar sin uso.
- [ ] **F4** — **Import bulk.** Si mañana hay que migrar tickets desde un Jira externo, se resuelve como script one-off contra `service_role`, no como feature.
- [ ] **F5** — **Colisiones de `key` post-backfill.** El pre-flight query de `plan.md` R-2 se corre antes de `db:push`; si devuelve filas, se resuelven manualmente. **Anotar la lista en la PR** (aunque sea vacía) para que quede el rastro.
