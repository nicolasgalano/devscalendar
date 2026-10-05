# Tasks — Adjuntos (imágenes) en tickets

- **ID:** 020-ticket-attachments
- **Plan reference:** `./plan.md`
- **Spec reference:** `./spec.md`
- **Estado:** draft

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

Fases:

- **Phase 1 — Base: migration + storage + types** (T1.1 – T1.6)
- **Phase 2 — API** (T2.1 – T2.5)
- **Phase 3 — Lib cliente (Canvas + upload)** (T3.1 – T3.3)
- **Phase 4 — UI (panel + lightbox)** (T4.1 – T4.7)
- **Phase 5 — Cierre** (T5.1 – T5.3)

---

## Phase 1 — Base: migration + storage + types

- [x] **T1.1** — Migration `supabase/migrations/00000000000020_ticket_attachments.sql`:
  - Tabla `ticket_attachments` con las columnas del §2.1 del plan.
  - Indexes en `ticket_id` y `project_id`.
  - RLS enable + 3 policies (read / insert / delete).
  - Grants `select, insert, delete` a `authenticated` (NO update).
  - Trigger `audit_ticket_attachment_events` + su función (§2.3 del plan).
  - _DoD:_ `pnpm db:push` limpio; `pnpm db:types` regenera `Database` con `ticket_attachments`.

- [x] **T1.2** — Crear bucket `ticket-attachments` privado en Supabase (dashboard o SQL). Documentar en el commit qué método se usó. Confirmar `public: false`.

- [x] **T1.3** — Storage RLS: policy de select sobre `storage.objects` para `authenticated` con el join contra `ticket_attachments` (§2.4 del plan). Insert/delete al bucket NO se dan a `authenticated` — el server usa `service_role`.

- [x] **T1.4** — `pnpm db:push` + `pnpm db:types`. Verificar que `Database["public"]["Tables"]["ticket_attachments"]` esté en `src/types/database.ts`.

- [x] **T1.5** — `src/lib/attachments/types.ts`: whitelist de MIMEs (`ATTACHMENT_MIME_TYPES`), tamaños (`MAX_ATTACHMENT_SIZE_BYTES = 5 MB`, `SOFT_TOTAL_PER_TICKET_BYTES = 50 MB`, `MAX_THUMB_SIZE_BYTES = 100 KB`), helper `extensionForMime(mime)`. Cero dependencias externas.

- [x] **T1.6** — `src/lib/attachments/permissions.ts`: `canUploadAttachment(viewer, ticket, project, roleInProject)` (reuso de `canEditTicket`) y `canDeleteAttachment(attachment, viewer, project)` (autor + PM primario + admin).

---

## Phase 2 — API

- [x] **T2.1** — `src/lib/validation/attachments.ts`: schemas Zod para el body del POST (validar `width`, `height`, tamaños). Nota: como es `multipart`, el schema valida el objeto derivado del `FormData`, no un JSON — se implementa un `parseAttachmentUploadForm(request)` helper.

- [x] **T2.2** — `src/app/api/tickets/[key]/attachments/route.ts` (POST):
  - Guard: `requireTicketAccess(key)` + permission check con `canUploadAttachment`.
  - Valida MIME/tamaño de `original` (whitelist).
  - Valida MIME del `thumb` = `image/webp`, tamaño ≤ 100 KB.
  - Genera `attachment_id` (uuid), `object_key`, `thumb_object_key` con slug ASCII normalizado.
  - Sube `original` al bucket (service_role client).
  - Sube `thumb` al bucket.
  - Si falla alguno de los uploads: intenta borrar el otro, responde 500.
  - Insert en `ticket_attachments`.
  - Si falla el insert: borra los dos objetos, responde 500.
  - Response 201 con la fila (sin URLs firmadas).

- [x] **T2.3** — `src/app/api/tickets/[key]/attachments/[id]/signed-url/route.ts` (GET):
  - Guard: `requireTicketAccess(key)` (read).
  - Valida que `attachment.ticket_id` matchee el ticket del path.
  - `variant=thumb|original` de query. Default `thumb`.
  - Llama `supabase.storage.from('ticket-attachments').createSignedUrl(path, 900)`.
  - Response `{ url, expires_at }`.

- [x] **T2.4** — `src/app/api/tickets/[key]/attachments/[id]/route.ts` (DELETE):
  - Guard: `requireTicketAccess(key)`.
  - Fetch de la fila → validar permiso con `canDeleteAttachment`.
  - `supabase.storage.from(...).remove([object_key, thumb_object_key])`.
  - `delete from ticket_attachments where id = ...`.
  - El trigger de audit corre solo.

- [ ] **T2.5** — Un test integración mínimo:
  - Insert de attachment → RLS permite read a viewer del proyecto.
  - RLS niega read a no-miembro.
  - Delete por autor OK; delete por no-autor sin ser admin/PM → 403.
  - _Aspiracional_ — se anota si no se hace.

---

## Phase 3 — Lib cliente

- [x] **T3.1** — `src/lib/attachments/generate-thumb.ts`: `generateThumb(file: File): Promise<GeneratedThumb>` con `createImageBitmap` + `OffscreenCanvas` + `convertToBlob({type:"image/webp",quality:0.8})`. Max side = 300 px. Devuelve `{ blob, width, height }`. Si el browser no soporta `OffscreenCanvas`, lanza error claro.

- [x] **T3.2** — `src/lib/attachments/upload.ts`: `uploadTicketAttachment(ticketKey, file, opts)`:
  - Valida MIME + tamaño client-side.
  - Llama `generateThumb`.
  - Arma `FormData` con `original`, `thumb`, `width`, `height`.
  - `fetch(POST, body: form)`.
  - Parsea response; retorna `AttachmentDTO` o tira error.

- [ ] **T3.3** — Unit test de `generateThumb`:
  - Fixture: PNG de 800×600.
  - Assert: el thumb devuelto tiene ambos lados ≤ 300, mantiene aspect-ratio, MIME `image/webp`.
  - Se apoya en `jsdom` o `happy-dom` con polyfills de `createImageBitmap`/`OffscreenCanvas`; si no está disponible, se skipea con `it.skip` documentando.

---

## Phase 4 — UI

- [x] **T4.1** — `src/lib/attachments/format.ts`: `formatBytes(n)` (`"1.4 MB"`, `"250 KB"`).

- [x] **T4.2** — `src/lib/tickets/query.ts`: extender `TicketDetail` con `attachments: AttachmentSummary[]`. Un embed en el select principal del ticket para no hacer round-trip aparte al abrir el detalle.

- [x] **T4.3** — `src/components/tickets/thumbnail-card.tsx`: card con `aspect-ratio` calculado desde `width`/`height`, `<img src={signedThumbUrl}>` con `useEffect` que pide la signed URL on mount, hover con nombre/tamaño/tiempo, botón borrar si `canDeleteAttachment`.

- [x] **T4.4** — `src/components/tickets/lightbox.tsx`: overlay full-screen con imagen a resolución completa (pide URL firmada `variant=original`), navegación con flechas/keyboard, cierre con `Esc`.

- [x] **T4.5** — `src/components/tickets/ticket-attachments-panel.tsx`: grid responsive de `<ThumbnailCard>`, botón "Subir imagen" (input file múltiple con `accept`), contador visible `"X de 50 MB usados"`, upload en paralelo con placeholders por archivo, integra `<Lightbox>` con estado local.

- [x] **T4.6** — `src/components/tickets/ticket-detail.tsx`: importar y montar `<TicketAttachmentsPanel>` debajo de la descripción y encima de `<TicketTimeEntries>`.

- [x] **T4.7** — Ajustes DESIGN.md: grid responsive (2/3/4/6 columnas según breakpoint), hover states del thumb, transitions en lightbox (200ms fade). Reutilizar tokens existentes (`--surface`, `--border`, radios).

---

## Phase 5 — Cierre

- [x] **T5.1** — `specs/features/README.md`: marcar 020 como done.
- [x] **T5.2** — `CLAUDE.md`:
  - Estructura del repo: sumar `src/lib/attachments/` con sus archivos.
  - Sección "Convenciones de código > Adjuntos": pipeline cliente genera thumb + server valida + RLS del bucket espeja `can_view_project`.
  - Estado de features: línea para 020.
- [ ] **T5.3** (pendiente — verificación visual del usuario) — Verificación visual del usuario en el navegador (checklist del §Phase 5.3 del plan).

---

## Blocked / follow-ups

- [ ] **F1 — Progreso de upload por archivo (%).** El `fetch` API no expone `progress` para uploads. Requeriría `XMLHttpRequest` o `ReadableStream` con adapter. Fuera de scope del MVP; el spinner "Subiendo…" alcanza.
- [ ] **F2 — Fase 2: paste de imágenes al editor rich text de 019.** Spec dedicada. El nodo `image` del schema ya vive reservado. Reusa el mismo endpoint POST de esta feature y suma el `attachment_id` como attr del mark. La relación asimétrica (borrar el nodo NO borra el adjunto) está documentada en R-9 de la spec.
- [ ] **F3 — Ampliar a otros MIME types (PDF, docx, zip).** La whitelist vive en un solo archivo. Sumar tipos = sumar entries + decidir el rendering en el panel (icono + descarga). Cero cambios en storage/RLS/endpoints.
- [ ] **F4 — Cleanup job de huérfanos.** Si Q-5 se vuelve un problema, un job cron que busca objetos en el bucket sin fila en `ticket_attachments` (con delay de gracia de 1 h) y los borra.
- [ ] **F5 — Rate limit de uploads por usuario/día.** Si aparece abuso (R-8 de la spec + R-13 del plan), un contador en `redis` o similar. No hay redis en el stack hoy.
- [ ] **F6 — Hard limit por ticket si el storage se dispara.** Volver de soft a hard con un `SELECT ... FOR UPDATE` para atajar concurrencia (R-7 original). Se decide cuando aparezca la señal.
- [ ] **F7 — Fallback a `<canvas>` DOM para browsers sin `OffscreenCanvas`.** Hoy tira error. Si un user real cae, se suma el fallback.
