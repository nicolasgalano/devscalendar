# Tasks — Documentos y PDF en adjuntos de tickets

- **ID:** 025-attachment-document-types
- **Plan reference:** `./plan.md`
- **Spec reference:** `./spec.md`
- **Estado:** draft

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

Fases:

- **Phase 1 — Migration** (T1.1 – T1.2)
- **Phase 2 — Shared layer: types + validador** (T2.1 – T2.3)
- **Phase 3 — Server: handler POST + signed-url** (T3.1 – T3.3)
- **Phase 4 — Cliente upload** (T4.1 – T4.2)
- **Phase 5 — UI panel** (T5.1 – T5.4)
- **Phase 6 — Tests + Cierre** (T6.1 – T6.4)

---

## Phase 1 — Migration

Una sola migration aditiva. Nullable para `thumb_object_key`/`width`/`height` y bump del check de `size_bytes` 5→10 MB. No toca RLS, triggers ni grants.

- [x] **T1.1** — Crear `supabase/migrations/00000000000023_attachment_doc_types.sql` con:
  - `alter table ticket_attachments alter column thumb_object_key drop not null, alter column width drop not null, alter column height drop not null;`
  - `alter table ticket_attachments drop constraint ticket_attachments_size_bytes_check;`
  - `alter table ticket_attachments add constraint ticket_attachments_size_bytes_check check (size_bytes > 0 and size_bytes <= 10485760);` (10 MB).
  - Header de comentario explicando qué extiende de 020 y por qué es aditiva pura.
  - **Antes de aplicar en producción**, verificar el nombre real del constraint con `select conname from pg_constraint where conrelid = 'public.ticket_attachments'::regclass and contype = 'c';`. Si difiere del default, actualizar el `drop constraint` con el nombre real (R-9 del plan).
- [ ] **T1.2** — `pnpm db:push` contra el proyecto de Supabase (lo corre el usuario como parte del deploy — no se aplica en dev local porque no hay base local). Después: `pnpm db:types` para regenerar `src/types/database.ts` — los tres campos deben pasar a `string | null` / `number | null`. _DoD: smoke SQL `select column_name, is_nullable from information_schema.columns where table_name='ticket_attachments' and column_name in ('thumb_object_key','width','height')` devuelve `YES` para las tres._

---

## Phase 2 — Shared layer: types + validador

- [x] **T2.1** — Expansión de `src/lib/attachments/types.ts`:
  - `ATTACHMENT_MIME_TYPES`: sumar 5 entradas (`application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
  - `extensionForMime`: sumar 5 cases (`pdf`, `doc`, `docx`, `xls`, `xlsx`).
  - `MAX_ATTACHMENT_SIZE_BYTES`: `5 * 1024 * 1024` → `10 * 1024 * 1024`.
  - Actualizar el comentario del archivo para mencionar que ahora acepta imágenes **y** documentos; el `object_key` y el bucket no cambian.
- [x] **T2.2** — Nuevos exports en `types.ts`:
  - `isImageMime(mime: string): mime is AttachmentMimeType` — true para los 4 image/*, false para el resto. Narrow de type para TypeScript.
  - `iconForMime(mime: AttachmentMimeType): { kind: 'image'|'pdf'|'word'|'excel'|'file'; tone: string }` — devuelve el kind lógico + el className de color (text-\*). Mapeo del plan §4.1: PDF → destructive, Word → primary, Excel → emerald, image/fallback → muted.
  - `buildObjectKey`: cambiar el tipo de retorno de `{ objectKey: string; thumbObjectKey: string }` a `{ objectKey: string; thumbObjectKey: string | null }`. Solo las imágenes generan `thumbObjectKey`; para doc/PDF devuelve `null`.
- [x] **T2.3** — Ajuste de `src/lib/validation/attachments.ts` (parser multipart):
  - Si `original.type` es imagen (via `isImageMime`): `thumb`/`width`/`height` siguen requeridos como en 020.
  - Si no es imagen: los tres se ignoran si vienen; no se agregan a `issues` por ausencia.
  - Parametrizar el string "El archivo pasa el límite (5 MB)" a `` `El archivo pasa el límite (${MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024} MB)` `` para no mentir después del bump.
  - Cambiar el tipo `ParsedAttachmentUpload`: `thumb`/`width`/`height` pasan a opcionales.
  - _DoD: `pnpm typecheck` verde. Un error esperado en el handler POST por el cambio de retorno de `buildObjectKey` — se arregla en Phase 3._

---

## Phase 3 — Server: handler POST + signed-url

- [x] **T3.1** — `src/app/api/tickets/[id]/attachments/route.ts`: bifurcación por `isImageMime(originalMime)`:
  - Si es imagen: validar que `parsed.data.thumb` esté presente (si no, 400); flujo igual a 020 (subir original + thumb; insertar fila con `thumb_object_key`, `width`, `height`).
  - Si no es imagen: subir solo `original`; insertar fila con `thumb_object_key: null`, `width: null`, `height: null`.
  - Cleanup: si el insert falla, `admin.storage.remove([objectKey])` para no-imagen, `remove([objectKey, thumbObjectKey])` para imagen (como está hoy).
  - El guard `canUploadAttachment` y la lectura de `project.pm_id` no cambian.
- [x] **T3.2** — `src/app/api/tickets/[id]/attachments/[attachmentId]/signed-url/route.ts`:
  - Agregar `original_filename` al `.select()` del `attachment`.
  - Si `variant === "thumb"` y `attachment.thumb_object_key` es null → responder 404 "Este adjunto no tiene thumbnail".
  - Aceptar query param `?download=1`: cuando está presente, pasar `{ download: attachment.original_filename }` como tercer argumento de `createSignedUrl`. Supabase Storage genera una URL que al abrirse devuelve `Content-Disposition: attachment; filename="..."`.
- [x] **T3.3** — DELETE handler (`[attachmentId]/route.ts`) ajustado para filtrar `thumb_object_key` null antes del `storage.remove`. `pnpm typecheck` verde al finalizar Phase 3.

---

## Phase 4 — Cliente upload

- [ ] **T4.1** — `src/lib/attachments/upload.ts`:
  - En `uploadTicketAttachment`: bifurcar por `isImageMime(file.type)`.
    - Si es imagen: flujo igual a 020 (llamar a `generateThumb` + append `thumb`, `width`, `height` al FormData).
    - Si no es imagen: skip `generateThumb`; el FormData solo lleva `original`.
  - El resto (validación de tamaño, POST, parseo de respuesta) no cambia.
- [ ] **T4.2** — Agregar al `fetchAttachmentSignedUrl` un cuarto parámetro opcional `options?: { download?: boolean }`. Si `options.download === true`, agregar `download=1` al query string. Default: false (compatibilidad con los call sites existentes del lightbox y del thumb).

---

## Phase 5 — UI panel

- [ ] **T5.1** — `src/components/tickets/ticket-attachments-panel.tsx`: cambios en el header de upload:
  - Reemplazar `ImagePlusIcon` por `PaperclipIcon` del `lucide-react`.
  - `"Subir imagen"` → `"Subir archivo"`.
  - Helper text: `"Hasta ${formatBytes(MAX_ATTACHMENT_SIZE_BYTES)} por archivo · imágenes, PDF, Word, Excel"`.
  - El `accept` attribute del `<input>` no se toca — ya consume `ATTACHMENT_ACCEPT_ATTR` que se actualiza automáticamente con los nuevos MIME types.
- [ ] **T5.2** — Renderer condicional en el `.map(initialAttachments)`:
  - Si `isImageMime(attachment.mimeType)`: `<ThumbnailCard ... />` como antes.
  - Si no: `<DocumentCard ... />` nueva.
  - `onDelete` se pasa a los dos siguiendo el mismo cálculo de `canDeleteAttachment`.
- [ ] **T5.3** — Nueva subcomponente `DocumentCard` en el mismo archivo:
  - Layout: `aspect-[3/2]`, flex centrado con el ícono grande (`size-12`), tono de color según `iconForMime`.
  - Mapeo ícono → componente de lucide: `pdf`/`word` → `FileTextIcon`; `excel` → `FileSpreadsheetIcon`; `image` → `ImageIcon`; `file` → `FileIcon`. Función helper `iconComponentForKind` local al componente.
  - Footer con `original_filename` (truncate) y `formatBytes(sizeBytes) · uploadedByName`.
  - Click → `fetchAttachmentSignedUrl(ticketId, id, "original", { download: true })` → `window.location.assign(url)` para disparar la descarga nativa.
  - Botón X de delete igual que `ThumbnailCard` (solo si `onDelete`).
  - Loading state mientras pide el signed URL (`disabled` + loader en el ícono).
- [ ] **T5.4** — Lightbox: no se toca. Las docs no entran al lightbox porque `openLightbox` solo se llama desde `ThumbnailCard`. Anotar F3 (navegación con flechas puede tocar un doc) como follow-up — ver abajo.

---

## Phase 6 — Tests + Cierre

- [ ] **T6.1** — Nuevo archivo `tests/unit/attachments-doc-types.test.ts`:
  - `isImageMime` para los 9 MIME types (4 true, 5 false) + un string random (false).
  - `iconForMime` para los 9 MIME types: cada uno devuelve el `kind` esperado.
  - `extensionForMime` para los 5 nuevos (pdf, doc, docx, xls, xlsx).
  - `buildObjectKey`:
    - Con `image/png`: `thumbObjectKey` **no null**, matchea el patrón `tickets/<id>/thumb/<attId>-<slug>.webp`.
    - Con `application/pdf`: `thumbObjectKey` **null**, `objectKey` matchea `tickets/<id>/original/<attId>-<slug>.pdf`.
- [ ] **T6.2** — Actualizar `specs/features/README.md`: sumar fila para 025 con status `code done — pending deploy + verificación visual`. En el párrafo descriptivo de 020 (que dice "solo imágenes en el MVP"), sumar nota de que 025 extiende la whitelist a PDFs y Office.
- [ ] **T6.3** — Actualizar `CLAUDE.md` (versión comprimida en main/develop):
  - Estructura del repo: en el bullet de `src/lib/`, el subdirectorio `attachments/` ya está mencionado — no cambia.
  - Estado de features: sumar línea de 025 debajo de 024 (orden cronológico) con el invariante clave ("extensión de 020: PDFs y Office en el panel con ícono por tipo, click → download via signed URL con download=1; mismo bucket + RLS, nueva migration 23 aditiva").
- [ ] **T6.4** — Verificación visual del usuario (post deploy):
  - Subir una imagen al ticket → thumbnail + lightbox como antes (regresión).
  - Subir un PDF → aparece como card con ícono rojo + nombre + tamaño; click → descarga con el nombre original.
  - Subir un Word (`.docx`) → ícono azul; descarga OK.
  - Subir un Excel (`.xlsx`) → ícono verde; descarga OK.
  - Subir un `.doc` legacy → ícono azul (mismo que `.docx`); descarga mantiene la extensión `.doc`.
  - Subir un archivo de 8 MB (dentro del nuevo límite) → entra. Un de 11 MB → rechazado client con "pasa el límite (10 MB)".
  - Un contributor sube un PDF; un PM del proyecto lo borra → audit_log guarda snapshot (verificable con `select diff from audit_log where entity='ticket_attachment' and action='delete' order by created_at desc limit 1`).
  - Correr `pnpm test:unit` → verde (incluye los tests nuevos de T6.1).

---

## Blocked / follow-ups

- [ ] **F1 — Preview inline de PDFs.** Si llega el pedido explícito, se agrega render condicional en `DocumentCard` para `mime_type === "application/pdf"` con un embed de pdf.js o un `<iframe>` apuntando al signed URL sin `download=1`. Spec aparte — hoy el default es siempre descarga (Q-1 y Q-3 del spec).
- [ ] **F2 — Validación de magic bytes server-side.** Si aparece abuso de archivos renombrados, sumar la lib `file-type` (~50 KB server-side) en el handler POST para verificar que los primeros bytes del `original` coinciden con el MIME declarado. Decidido no agregar hoy (Q-4 del spec).
- [ ] **F3 — Lightbox salta a docs al navegar con flechas.** Si el ticket tiene mezcla imagen/doc, la navegación con flecha ←/→ puede ir a un índice que es un doc; el lightbox queda sin URL para renderizar. Mitigación futura: filtrar `initialAttachments.filter(isImage)` para la navegación del lightbox. Trabajo chico, pero sin urgencia porque los paneles reales suelen tener grupos homogéneos.
- [ ] **F4 — Más tipos** (PowerPoint, CSV, TXT, ZIP). Sumar entries a `ATTACHMENT_MIME_TYPES` + mapear íconos en `iconForMime` + extensión en `extensionForMime`. Zero migration, zero cambios en storage/RLS.
- [ ] **F5 — Thumbnail server-side para PDFs/docs.** Primera página del PDF o del docx renderizada como imagen. Requiere Edge Function con conversor headless (LibreOffice, Ghostscript). Fuera de MVP; si entra, se puebla `thumb_object_key` para no-imagen también y el panel renderiza igual que las imágenes.
- [ ] **F6 — Límite por tipo diferenciado.** Si aparece un pedido concreto (ej. "necesito subir un PDF de 25 MB"), tabla por tipo o config vía UI. Hoy mantiene uniformidad: 10 MB para todo.
- [ ] **F7 — Compresión server-side de imágenes al upload.** Si el bump 5→10 MB causa cost creep en Supabase Storage, un paso de recompresión en el handler (Sharp o Edge Function) reduce peso. Mitigación anotada en R-4 de la spec.
