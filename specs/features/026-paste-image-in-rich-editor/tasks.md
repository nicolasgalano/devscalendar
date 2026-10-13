# Tasks — Paste image in rich editor

- **ID:** 026-paste-image-in-rich-editor
- **Plan reference:** `./plan.md`
- **Status:** todo

Task format: `[ ]` open, `[x]` done, `[~]` in progress, `[!]` blocked. Each phase is independently mergeable and deployable.

---

## Phase 1 — Data & schema

- [ ] **T1.1** — Create migration `supabase/migrations/0024_ticket_attachments_source.sql` adding `source text not null default 'panel' check (source in ('panel','paste'))` to `ticket_attachments`. Include `comment on column`. _DoD: `pnpm db:push` applies cleanly on the linked Supabase project; existing rows get `'panel'` (verified via query); RLS, triggers, policies unaffected._
- [ ] **T1.2** — Regenerate types with `pnpm db:types`. _DoD: `src/types/database.ts` reflects the new `source` column on `ticket_attachments`; `tsc --noEmit` clean._
- [ ] **T1.3** — Extend the `image` node definition in `src/lib/editor/schema.ts` with `attrs: { attachment_id, alt, width, height }`. Keep the node declared but still inert (no toolbar, no paste handler yet). _DoD: `RICH_TEXT_SCHEMA.nodes.image.attrs.attachment_id` exists; existing tests pass; grep for consumers of the old shape shows none affected._
- [ ] **T1.4** — Update Zod validator in `src/lib/validation/rich-text.ts` + `src/lib/editor/validate.ts` to require `attachment_id` as uuid when node type is `image`, and reject `src` or any extra attrs from untrusted input. _DoD: unit tests for the validator pass; a doc with `image` + `attachment_id` is accepted, without is rejected, with `src` field is rejected._

**Phase 1 commit + merge + deploy.** Nothing user-visible changes; the schema and column are in place.

---

## Phase 2 — API + validator + renderer

- [ ] **T2.1** — Add `source` to the Zod schema for the attachment upload endpoint. Default `'panel'`; enum `['panel', 'paste']`. _DoD: `src/lib/validation/attachment.ts` (or wherever the existing schema lives) accepts both; rejects other values with 400._
- [ ] **T2.2** — Update `POST /api/tickets/:key/attachments` to read `source` from the FormData, validate via T2.1 schema, and insert into `ticket_attachments.source`. Preserve existing happy path for callers that don't send `source`. _DoD: curl with `source=paste` persists the value; curl without the field persists `panel`; unit test for the handler covers both._
- [ ] **T2.3** — Return `source` in the API response payload. _DoD: 201 response body includes `"source": "paste"` (or `"panel"`); existing API consumers tolerate the extra field (verified by typecheck)._
- [ ] **T2.4** — Extend `renderDocToHtml` in `src/lib/editor/render.ts` to handle the `image` node. Signature changes to accept `opts.attachments: Map<string, Attachment>` and `opts.ticketId: string`. Emit `<img src>` from `attachment.signed_thumbnail_url` with `data-attachment-id`; emit placeholder span when attachment missing or `ticket_id` mismatch. _DoD: `tests/unit/render-image-node.test.ts` covers found / not-found / cross-tenant cases._
- [ ] **T2.5** — Update `src/components/tickets/ticket-detail.tsx` to build `attachmentsMap` with pre-signed thumbnail URLs (via `storage.from().createSignedUrl()`) in parallel with existing queries, and pass it to `<RichTextViewer>`. _DoD: no extra DB queries introduced (verified by log inspection in dev); `Promise.all` groups the signing calls; render output has `<img>` tags with signed URLs for sample doc._
- [ ] **T2.6** — Update `<RichTextViewer>` in `src/lib/editor/rich-text-viewer.tsx` to accept `attachments` prop and forward it to `renderDocToHtml`. _DoD: prop is typed, no `any`; existing consumers (comments, descriptions in detail view) pass the prop or `undefined`; renderer handles `undefined` as empty map._

**Phase 2 commit + merge + deploy.** Posting via API with `source=paste` works, and a manually-crafted doc with `image` nodes renders correctly. Editor still doesn't emit the nodes — Phase 3 enables that.

---

## Phase 3 — Hook unification + paste handler

- [ ] **T3.1** — Create `src/lib/attachments/use-upload.ts` with `useAttachmentUpload({ ticketKey })` hook. Encapsulates FormData construction, fetch, thumb generation call, progress callbacks, error normalization. _DoD: hook is pure (no side effects beyond fetch); unit test covers success / size error / MIME error / network error paths._
- [ ] **T3.2** — Refactor `<TicketAttachmentsPanel>` in `src/components/tickets/attachments-panel.tsx` to consume `useAttachmentUpload` instead of its inline upload code. _DoD: panel upload still works identically (manual smoke in dev); no change to UX or button behavior; tests for the panel still pass._
- [ ] **T3.3** — Create `src/lib/editor/paste-image.ts` with `createImagePasteHandler({ ticketKey, onUploadStart, onUploadComplete, onUploadError })`. Detects image items in `ClipboardEvent.clipboardData.items`, respects AC-1.2 (text wins), uploads each image via `useAttachmentUpload`. _DoD: handler returns `true` only when it intercepts; returns `false` otherwise; unit test with mocked clipboard events covers image-only, image+text, multiple images, non-image MIME._
- [ ] **T3.4** — Create `src/components/tickets/image-uploading-placeholder.tsx` — client component that shows `URL.createObjectURL(file)` with spinner overlay. Revokes URL on unmount and on upload complete/error. _DoD: component renders without errors; `URL.revokeObjectURL` is called in cleanup (verified by test or review); accepts optional `error` prop for brief error state before removal._
- [ ] **T3.5** — Wire the paste handler + placeholder into `<RichTextEditor>` in `src/lib/editor/rich-text-editor.tsx`. Add optional prop `ticketKey`; when present, add `editorProps.handlePaste` and register the node view for `image` that renders `<ImageUploadingPlaceholder>` while uploading, then switches to the resolved `<img>` once `attachment_id` is set. _DoD: pasting a screenshot in dev inserts a placeholder, replaces it with the final image, and the panel refreshes to show the new attachment with `source='paste'`._
- [ ] **T3.6** — Wire `ticketKey` through `<TicketFormDialog>` to `<RichTextEditor>` in edit mode (not create mode — Q-5 in spec). In create mode, keep the editor without paste handler and show a hint on paste attempt. _DoD: editing a ticket allows paste; creating a new ticket doesn't; the hint "Guardá el ticket primero para pegar imágenes" shows when pasting in create mode._
- [ ] **T3.7** — Wait for in-flight uploads at form submit (AC-3.4). Use `useSyncIndicator()` to track active uploads; the submit handler waits up to 15 s with the indicator visible, then proceeds. _DoD: pasting an image and quickly clicking submit waits for the upload before persisting the doc; after 15 s timeout, submits with a toast "Algunas imágenes no terminaron de subir"._

**Phase 3 commit + merge + deploy.** First functional end-to-end paste. Panel distinguishes `source` in DB but not visually yet.

---

## Phase 4 — Drop handler + badge + hint + lightbox link

- [ ] **T4.1** — Create `src/lib/editor/drop-image.ts` with `createDropHandler`. For dropped image files → same pipeline as paste. For dropped doc files (`025` whitelist) → upload with `source='panel'` + toast "Adjuntado al ticket" linking to the panel. For other MIME → no-op. _DoD: dragging a screenshot into the editor inserts it; dragging a PDF only updates the panel; dragging an unsupported file does nothing; unit test covers all three branches._
- [ ] **T4.2** — Add `handleDrop` to `<RichTextEditor>` editorProps alongside `handlePaste`. _DoD: both work; dropping doesn't conflict with Tiptap's internal block drag (verified by trying to drag a paragraph internally)._
- [ ] **T4.3** — Add visual badge for `source='paste'` in `<TicketAttachmentsPanel>`. Icon `Clipboard` from `lucide-react`, shows on hover of the attachment card (not permanent). Tooltip: "Pegado desde el portapapeles". _DoD: paste-sourced attachments show the icon in hover; panel-sourced do not; borrar / descargar / lightbox still work identically._
- [ ] **T4.4** — Add empty-state hint in `<RichTextEditor>` when doc is empty: "`Cmd/Ctrl+V` para pegar screenshots". Shows as subtle muted text below the placeholder. Only in edit mode (where paste is active). _DoD: new editor instance in edit mode with empty doc shows the hint; typing anything hides it; create mode doesn't show it._
- [ ] **T4.5** — Make `<img>` tags emitted by the renderer clickable, opening the same lightbox used by the panel. Reuse the lightbox component from `020`; the hydrator pattern (like `<TaskItemHydrator>` for checkboxes) attaches click handlers to `img[data-attachment-id]` elements on the client. _DoD: clicking an inline image in the viewer opens the full-size lightbox; keyboard nav (`Esc`, arrows) works; images shared via `data-attachment-id` resolve to the correct attachment._
- [ ] **T4.6** — Verify `renderDocToHtml` handles the deleted-attachment case visually. The placeholder span gets a `.deleted-attachment` class with a muted icon + text. _DoD: manually delete an attachment that's referenced from a doc, reload the detail — the doc shows "Imagen eliminada" placeholder, not a broken image._

**Phase 4 commit + merge + deploy.** Full UX of the paste-and-drop flow.

---

## Phase 5 — Tests + cierre

- [ ] **T5.1** — Unit tests from T2.1, T2.4, T3.1, T3.3, T3.4, T4.1 are all green in `pnpm test:unit`. Add any missing. _DoD: coverage includes all critical pure logic (handler decisions, renderer branches, validator rules, hook state transitions)._
- [ ] **T5.2** — Integration tests: `tests/integration/attachment-source-column.test.ts` (POST with/without `source`, invalid value); `tests/integration/rich-text-doc-with-image.test.ts` (insert attachment + doc, verify render; delete attachment, verify placeholder). _DoD: both tests pass against ephemeral Supabase stack in CI._
- [ ] **T5.3** — Smoke test: `tests/smoke/attachments-batch-fetch.test.ts` verifies that fetching a ticket with 10 attachments is one PostgREST query, not N+1. _DoD: query count asserted via log inspection or by using a wrapped client; test passes in CI smoke run._
- [ ] **T5.4** — Manual verification in production (post-deploy): execute each scenario from plan §10 "Manual" (paste in description, in comment, delete node, delete attachment, oversized paste, cross-browser). Document any findings in the PR description. _DoD: all scenarios behave as spec'd; any discrepancies filed as new issues or added to deuda-tecnica.md._
- [ ] **T5.5** — Update `CLAUDE.md`: add a short note under "Editor rich text" about the active `image` node + `ticket_attachments.source` relation, and under "Adjuntos" about the new column. Keep it dense and in the same voice as the existing section. _DoD: `CLAUDE.md` reflects reality; a reviewer reading only the changed sections understands the new behavior without reading the spec._
- [ ] **T5.6** — Update `specs/features/README.md`: mark `026` as `code done` (status), fill in the one-paragraph summary like the other features, update any dependency arrows if needed. _DoD: README index shows `026` with current status and summary._
- [ ] **T5.7** — Open PR to `develop`; after merge, bump to `main` to trigger deploy. Follow the iterative-deploy flow (one phase per PR, or bundled if the user prefers). _DoD: PR merged; deploy green on Vercel; smoke query confirms a paste-sourced attachment lands in the DB._

---

## Open gates for the next spec (future work, not in scope here)

- **Garbage collection of orphaned attachments** (uploaded by paste in a canceled form). Not implemented in MVP — track in deuda-tecnica if it becomes observable.
- **Resize handles on inline images** (drag to resize). Punted. Attrs `width`/`height` on the node are already reserved.
- **Caption / alt editing** below inline images. Punted.
- **Server-side thumbnail pipeline** (sharp / edge function). Still handled client-side via `020`'s existing code; unchanged.
