# Tasks — Editor rich text para descripciones de tickets

- **ID:** 019-ticket-rich-editor
- **Plan reference:** `./plan.md`
- **Spec reference:** `./spec.md`
- **Estado:** draft

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

Fases:

- **Phase 1 — Schema + validador + renderer server** (T1.1 – T1.5)
- **Phase 2 — Editor client (Tiptap)** (T2.1 – T2.5)
- **Phase 3 — Viewer + hidratación de checkbox** (T3.1 – T3.3)
- **Phase 4 — API** (T4.1 – T4.3)
- **Phase 5 — UI touchpoints** (T5.1 – T5.4)
- **Phase 6 — Migración de datos** (T6.1 – T6.3)
- **Phase 7 — Testing** (T7.1 – T7.5) — aspiracional
- **Phase 8 — Cierre** (T8.1 – T8.4)

Las fases 1 a 4 se pueden desarrollar **en paralelo** por dos personas (una en 1+3+4 backend/render, otra en 2 editor); recién se juntan en la Phase 5. Phase 6 es orquestación (script + ejecución manual coordinada con el deploy).

---

## Phase 1 — Schema + validador + renderer server

- [x] **T1.1** — Migration `supabase/migrations/00000000000019_ticket_description_doc.sql` (terminó siendo la **19** por la migration fantasma 18 descubierta al pushear — ver D-10 en `docs/deuda-tecnica.md`):
  - `alter table public.tickets add column description_doc jsonb;`
  - `comment on column public.tickets.description_doc is '...'` (texto del §2.1 del plan).
  - `create or replace function public.audit_ticket_events()` idéntica a la actual pero con el bloque `if diff ? 'description_doc' then diff := jsonb_set(diff, '{description_doc}', to_jsonb('__changed__'::text)); end if;` antes del `insert` genérico (§2.4 del plan).
  - Comentario al final del `enforce_ticket_contributor_scope` recordando la herencia positiva (§2.3). _No se cambia el cuerpo del trigger._
  - _DoD:_ `pnpm db:push` limpio; `pnpm db:types` regenera `Database` con `description_doc: Json | null` en `tickets`.
- [x] **T1.2** — `src/lib/editor/schema.ts` — declara `RICH_TEXT_SCHEMA` (nodos, marks, atributos, whitelist de `codeBlock.language`, whitelist de protocolos de `link.href`). Exporta también los tipos derivados (`RichTextNodeType`, `RichTextMarkType`) para consumo tipado.
- [x] **T1.3** — `src/lib/editor/validate.ts` — `validateProseMirrorDoc(input, schema): { ok: true, doc, plainText } | { ok: false, errors }`. Recorrido recursivo del árbol validando `type`, `attrs`, `content`. Extrae `plainText` acumulando nodos `text` + un `\n` por bloque cerrado. Rechaza docs con nodo `image` (§5.2 del plan). No importa `prosemirror-model` en runtime — validador puro sobre JSON.
- [x] **T1.4** — `src/lib/validation/rich-text.ts` — `richTextDocSchema` (Zod) que wrappea `validateProseMirrorDoc` y suma la validación de `plainText.length <= 10_000`. Se exporta para reuso desde `tickets.ts` de validación.
- [x] **T1.5** — `src/lib/editor/render.ts` — `renderDocToHtml(doc): string` con dispatch table por tipo de nodo/mark. Escapa texto y atributos. Emite `<pre><code class="language-{lang}">` con resaltado de lowlight server-side (import estático de `lowlight/lib/common` — sub-KB, aceptable). Para `taskItem` emite `<li data-task-index="{i}" data-checked="…"><span data-task-item-marker></span>…</li>` (§4.3 del plan). Links con `target="_blank" rel="noopener noreferrer"` forzados.

---

## Phase 2 — Editor client (Tiptap)

- [x] **T2.1** — Dependencias npm: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-code-block-lowlight`, `@tiptap/extension-image`, `@tiptap/extension-placeholder`, `lowlight`. Fijar versiones compatibles entre sí (Tiptap 2.x, versiones alineadas).
- [x] **T2.2** — `src/lib/editor/tiptap-extensions.ts` — configuración de extensiones que consume el `RichTextEditor`. Traduce `RICH_TEXT_SCHEMA` a la config real de Tiptap. Restringe `heading` a `[1, 2, 3]`. Configura `codeBlockLowlight` con el subset de lenguajes del plan §5.1. Configura `link` con `openOnClick: false`, `autolink: true`, `linkOnPaste: true`, `protocols: ['http','https','mailto']`. Configura `image` con `HTMLAttributes: {}` (declarado sin toolbar).
- [x] **T2.3** — `src/lib/editor/paste.ts` — `sanitizePastedHtml(html): string`. Parsea con `DOMParser` (client-only), recorre el DOM aplicando el mapping tag→node del schema, descarta `<img>`, `<script>`, `<style>`, `<iframe>`, y todo atributo fuera de whitelist. Devuelve HTML normalizado. Se cablea en el `EditorProps.transformPastedHTML` en T2.5.
- [x] **T2.4** — `src/lib/editor/link-popover.tsx` — `<LinkPopover editor, open, onOpenChange>` con dos inputs (texto + URL), botón "Aplicar" (disabled si URL inválida), botón "Quitar" (visible si la selección ya es link). Usa `Popover` de shadcn anclado al DOM del editor.
- [x] **T2.5** — `src/lib/editor/rich-text-editor.tsx` — `<RichTextEditor>` client component:
  - `useEditor` con extensiones de T2.2 y `EditorProps.transformPastedHTML = sanitizePastedHtml`.
  - Toolbar sticky (`sticky top-0 z-10 bg-background`) con botones y tooltips + atajos (`Cmd/Ctrl+B/I/E/K`, `Cmd/Ctrl+Z`).
  - `onUpdate` → llama `onChange(doc, plainText)` y `onDirtyChange(dirty)`.
  - Hard-limit del texto plano: revierte con `editor.commands.undo()` si el próximo update excede `maxPlainTextLength`.
  - Contador `{plainText.length} / {maxPlainTextLength}` al pie, coloreado según proximidad al límite.
  - `<LinkPopover>` disparado por botón y por `Cmd/Ctrl+K`.
  - `disabled` desactiva el editor (Tiptap `setEditable(false)`).

---

## Phase 3 — Viewer + hidratación de checkbox

- [x] **T3.1** — `src/lib/editor/rich-text-viewer.tsx` — `<RichTextViewer doc, className, ticketId?, canEditChecklist?, expectedUpdatedAt?>` server component. Si `doc == null` o es doc vacío → placeholder "Sin descripción" (mismo copy que `MarkdownViewer`). Si no, inyecta `renderDocToHtml(doc)` con `dangerouslySetInnerHTML` dentro del wrapper con clases `prose` equivalentes al `MarkdownViewer` actual. Si `canEditChecklist && ticketId`, monta al lado `<TaskItemHydrator doc={doc} ticketId={ticketId} expectedUpdatedAt={expectedUpdatedAt} />`.
- [x] **T3.2** — `src/lib/editor/task-item-hydrator.tsx` — client component. `useEffect` que:
  1. Busca `span[data-task-item-marker]` dentro del contenedor hermano.
  2. Por cada marker, mapea al `taskItem` correspondiente en `doc` (índice DFS en preorden).
  3. Renderiza un `<input type="checkbox">` con `checked` reflejando el atributo del doc y un handler `onChange` que:
     - Arma un doc nuevo con el atributo `checked` invertido en ese nodo.
     - `useSyncIndicator().start("Actualizando checklist")`.
     - `PATCH /api/tickets/{ticketId}` con `{ description_doc, expected_updated_at }`.
     - Si 200: `router.refresh()` (el server re-renderiza el viewer con el doc nuevo).
     - Si 409: recarga (`router.refresh()`) y muestra toast "La descripción cambió, probá de nuevo".
- [x] **T3.3** — Estilos: verificar que `renderDocToHtml` + wrapper `prose` producen exactamente lo que muestra Tiptap adentro del editor. Si hay divergencia (padding de blockquote, ancho de code block, indentación de listas anidadas), ajustar clases del wrapper o del renderer hasta que coincidan visualmente. _Es la mitigación de R-4 del plan._

---

## Phase 4 — API

- [x] **T4.1** — Extender `src/lib/validation/tickets.ts`:
  - `createTicketSchema`: eliminar `description`; agregar `description_doc: richTextDocSchema.nullable().optional()`.
  - `updateTicketSchema`: eliminar `description`; agregar `description_doc: richTextDocSchema.nullable().optional()` y `expected_updated_at: z.string().datetime().optional()`.
  - Ajustar el `.refine("Nada para actualizar")` para no contar `expected_updated_at` como campo de update (§5.3 del plan).
- [x] **T4.2** — `src/app/api/tickets/route.ts` (POST): reemplazar el spread `description: description ?? null` por `description_doc: description_doc ?? null`. Actualizar el insert. Eliminar cualquier lectura de la clave vieja `description`.
- [x] **T4.3** — `src/app/api/tickets/[id]/route.ts` (PATCH):
  - Antes del `.update()`, si `parsed.data.expected_updated_at` existe, comparar con `ticket.updated_at`. Si difieren → 409 `{ reason: "conflict", currentUpdatedAt: ticket.updated_at }`.
  - Cambiar la spread condicional `description` por `description_doc`. Eliminar la escritura de la columna vieja del `.update()`.
  - Traducción de errores no cambia (Zod ya rechaza docs inválidos con 400).

---

## Phase 5 — UI touchpoints

- [x] **T5.1** — `src/components/tickets/ticket-form-dialog.tsx`:
  - Cambiar el shape de `TicketFormInitial`: `description: string` → `descriptionDoc: JSONContent | null`.
  - Reemplazar el import de `MarkdownEditor` por `dynamic(() => import("@/lib/editor/rich-text-editor").then(m => m.RichTextEditor), { ssr: false, loading: EditorSkeleton })`.
  - Pasar `onDirtyChange` al editor; guardar `dirty` en estado.
  - Botón "Cancelar": si `dirty`, dispara `<ConfirmDiscardDialog>`; si no, cierra directo.
  - Body del `fetch`: cambia `description` por `description_doc`; el doc con solo un párrafo vacío se envía como `null` (`isEmptyDoc(doc)`).
- [x] **T5.2** — `<ConfirmDiscardDialog>` — `AlertDialog` de shadcn en `src/components/tickets/confirm-discard-dialog.tsx`. Copy: "Vas a descartar los cambios que hiciste. ¿Seguro?". Botones: "Seguir editando" (cancel), "Descartar" (destructive).
- [x] **T5.3** — `src/components/tickets/ticket-detail.tsx`:
  - Reemplazar `<MarkdownViewer content={optimistic.description} />` por un helper `<TicketDescription>` local que elige la ruta:
    - `optimistic.descriptionDoc != null` → `<RichTextViewer doc={descriptionDoc} ticketId={ticket.id} canEditChecklist={canEdit} expectedUpdatedAt={ticket.updatedAt} />`.
    - Si no y `optimistic.description` no vacío → `<MarkdownViewer content={description} />` (fallback AC-5.3).
    - Si no → `<RichTextViewer doc={null} />` (placeholder).
  - `editInitial.descriptionDoc = optimistic.descriptionDoc ?? convertMarkdownAdHoc(optimistic.description)` (§7.2 del plan) — la conversión al vuelo se hace acá solo si el ticket no fue migrado. `convertMarkdownAdHoc` vive en `src/lib/editor/convert.ts` compartido con el script (T6.1).
  - El `optimistic` state del checkbox interactivo se maneja acá: al recibir el update del hydrator, actualizar `optimistic.descriptionDoc`.
- [x] **T5.4** — Borrar `src/lib/markdown/editor.tsx`. Confirmar que no queden referencias (`grep -r MarkdownEditor src/` → 0 resultados). _No borrar_ `viewer.tsx` ni `sanitize.ts` (fallback vivo hasta la fase 2, feature 019.5).

---

## Phase 6 — Migración de datos

- [x] **T6.1** — `src/lib/editor/convert.ts` — `markdownToProseMirrorDoc(md: string): JSONContent`. Usa `unified` + `remark-parse` + `remark-gfm` para parsear a mdast; camina el AST y emite JSON del schema (§3 del plan). Descarta imágenes, HTML crudo y tablas con log. Compartido entre el script (T6.2) y `convertMarkdownAdHoc` (T5.3).
- [x] **T6.2** — `scripts/migrate-ticket-descriptions.ts` (TS en vez de mjs — necesita importar `convert.ts`; corre con `pnpm exec tsx`) — Node script:
  - Cliente Supabase con service role (leer de env).
  - Flags: `--dry-run`, `--limit N`.
  - Selecciona `id, key, description` where `description is not null and description <> '' and description_doc is null`.
  - Por cada uno: convierte con `markdownToProseMirrorDoc`, valida con `validateProseMirrorDoc`, escribe si OK, skippea con log si falla.
  - Log por lote de 100: `[N converted, M skipped, K remaining]`.
  - Al final: resumen total.
- [ ] **T6.3** (pendiente — lo corre el usuario en el deploy) — Ejecución (paso manual del deploy, documentado en `plan.md` §6.3):
  1. Correr `pnpm db:push` (aplica migration 19).
  2. `pnpm exec tsx scripts/migrate-ticket-descriptions.ts --dry-run` → revisar output.
  3. `pnpm exec tsx scripts/migrate-ticket-descriptions.ts` → real.
  4. `select count(*) from tickets where description_doc is not null;` en el dashboard de Supabase.
  5. Push a `main` (deploy del código de `019`).
  6. Verificación en el browser: abrir 3-5 tickets viejos, ver que renderizan bien.

---

## Phase 7 — Testing (aspiracional)

Sigue la política del proyecto: se documenta lo que la Phase debería cubrir; ejecución puede quedar abierta si el equipo no la prioriza.

- [ ] **T7.1** — Unit `validateProseMirrorDoc`: docs válidos aceptados; nodo `image` rechazado; nodo desconocido rechazado; `link.href` con `javascript:` rechazado; `plainText > 10.000` rechazado; `codeBlock.language` fuera de la whitelist rechazado.
- [ ] **T7.2** — Unit `renderDocToHtml`: paridad visual con `generateHTML(doc, extensions)` de `@tiptap/html` para un catálogo de docs (headings anidados, listas anidadas, taskList mixto, blockquote con link, codeBlock con y sin language, doc con solo párrafo vacío).
- [ ] **T7.3** — Unit `sanitizePastedHtml`: paste de Google Docs (span con style) → sin style; paste con `<img>` → descartado sin unwrap; `<script>` → descartado; `<a href="javascript:">` → link descartado, texto conservado.
- [ ] **T7.4** — Unit `markdownToProseMirrorDoc`: markdown con task lists / code fences / headings anidados / links → doc válido y `plainText` incluye todo el texto del markdown. Un markdown roto (listas mal cerradas) → no lanza, produce doc "mejor esfuerzo".
- [ ] **T7.5** — Integración: contributor intentando `PATCH` con `description_doc` sobre ticket ajeno → 403 con hint del trigger. Update de `description_doc` deja fila en `audit_log` con `diff.description_doc === '__changed__'`.

---

## Phase 8 — Cierre

- [x] **T8.1** — Actualizar `specs/features/README.md`: `019` como done con una línea de resumen (editor Tiptap + JSON storage + fase 2 pendiente).
- [x] **T8.2** — Actualizar `CLAUDE.md`:
  - Estructura del repo: agregar `src/lib/editor/` con sus archivos.
  - Sección "Convenciones de código > Editor rich text" nueva con las reglas (whitelist única, viewer server-side sin Tiptap, `MarkdownViewer` sigue vivo como fallback, contributor scope heredado).
  - Estado de features: línea para 019.
  - Sección "Migrations": nota de que la migration siguiente (fase 2 — drop de `description` + borrado de deps markdown) es intencional.
- [x] **T8.3** — Anotar en `docs/deuda-tecnica.md`: **fase 2 pendiente** (drop de `tickets.description` + borrado de `src/lib/markdown/*` + remoción de `react-markdown`, `remark-gfm`, `rehype-sanitize` del `package.json`). Dueño y motivo explícitos. **No saldar sin OK explícito** (regla del `CLAUDE.md`).
- [ ] **T8.4** (pendiente — verificación visual del usuario) — Verificación visual del usuario en el browser:
  - Crear ticket con formato variado (headings, listas, checklist, code block, link, blockquote).
  - Editar el mismo ticket, cambiar el formato, guardar.
  - Cancelar una edición con cambios pendientes → aparece el confirm.
  - Cancelar sin cambios → cierra directo.
  - Abrir un ticket viejo migrado → se ve bien.
  - Abrir un ticket viejo que quedó sin migrar (si aplica) → se ve con el `MarkdownViewer`.
  - Pegar contenido desde Google Docs → llega limpio.
  - Pegar una screenshot del portapapeles → se ignora silenciosamente (nada aparece; `020` lo va a resolver).
  - Marcar un checkbox desde el detalle → persiste; recargar mantiene el estado.
  - Probar como contributor: la descripción no se puede editar (control esconde); si por API mando `description_doc` → 403.

---

## Deuda descubierta durante esta feature

- **D-10 — Migration fantasma `time_entries_start_time` (versión 18).** Descubierta al aplicar la primera versión de la migration de `019` (que originalmente había quedado numerada 18). Prod tenía la fila en `schema_migrations` sin archivo local, y `db:push` respondía "up to date" sin aplicar nada. Se mitigó creando `supabase/migrations/00000000000018_time_entries_start_time.sql` como stub idempotente (`if not exists`) para desbloquear el push de la 19. **No se saldó**: el SQL original puede diverger del stub, y no se investigó de dónde vino. Anotada en `docs/deuda-tecnica.md` D-10 con el detalle. **No tocar sin OK explícito.**

---

## Blocked / follow-ups

- [ ] **F1 — Feature 019.5: drop de `tickets.description` + borrado de dependencias.** Migration `alter table tickets drop column description;` + borrar `src/lib/markdown/`, `<MarkdownViewer>` del `TicketDescription` helper, y dependencias `react-markdown`, `remark-gfm`, `rehype-sanitize`, `unified`, `remark-parse` del `package.json`. **Prerequisito:** verificar en producción que 100% de los tickets tienen `description_doc != null` durante ≥ 1 semana sin issues. Sin ese gate, breakea la ruta de fallback.
- [ ] **F2 — Menciones `@usuario`.** Extensión `@tiptap/extension-mention` + suggestion provider consultando `project_members` del ticket. Al mencionar, dispara notificación in-app + email (misma cadena de `010`). Requiere migration menor para el trigger de notificación de mención.
- [ ] **F3 — Slash commands.** Al escribir `/` abre un menú de bloques (heading, checklist, code, image cuando exista). Es puramente UX cliente — cero cambios de schema o API.
- [ ] **F4 — Tablas.** Extensión `@tiptap/extension-table` + agregarla a `RICH_TEXT_SCHEMA`. Sumar handlers en `renderDocToHtml` y en el paste sanitizer. Sin caso de uso claro hoy — se activa cuando aparezca.
- [ ] **F5 — Colaboración en tiempo real (Y.js).** Cambia el modelo de persistencia (Yjs doc + snapshots periódicos). Requiere infra propia (WebSocket, autoridad de sync). Feature dedicada cuando el equipo lo pida.
- [ ] **F6 — Autosave / drafts locales.** El diálogo actual pierde cambios al cerrar sin guardar (el `<ConfirmDiscardDialog>` de T5.2 mitiga, no elimina). Un autosave a `localStorage` por `ticketId` recupera el borrador. Fuera de scope del MVP.
- [ ] **F7 — Aplicar el editor rich text a otros campos.** `sprints.goal`, `projects.description`, notas de reserva, notes de time entries — hoy son `<textarea>` o `<input>` planos. Si el equipo quiere consistencia, el `<RichTextEditor>` reusa sin cambios, pero cada campo requiere su propia columna `jsonb` + migración + validación. Trabajo lineal por campo.
- [ ] **F8 — Búsqueda por texto en descripción.** Derivar el `plainText` a una columna `generated always as (...) stored` + índice `tsvector` habilitaría filtros full-text en la lista de tickets. No hay caso concreto hoy — los filtros existentes son sobre `title`.
