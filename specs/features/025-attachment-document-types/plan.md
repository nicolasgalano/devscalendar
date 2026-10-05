# Plan — Documentos y PDF en adjuntos de tickets

- **ID:** 025-attachment-document-types
- **Spec reference:** `./spec.md`
- **Estado:** draft
- **Depende de:** `020-ticket-attachments` (bucket privado, RLS, trigger de audit, endpoints base, panel). `015-project-membership-and-tickets` (RLS, permisos sobre tickets).

---

## 1. Resumen técnico

Feature chica — extensión horizontal de `020` sin cambios estructurales. **Una sola migration** aditiva (nullable + bump de check), expansión del whitelist en un solo archivo (`types.ts`), bifurcación por `isImageMime` en 4 lugares (handler POST, handler signed-url, cliente `upload.ts`, panel UI). La RLS, el bucket, el trigger de notificación y el audit log de `020` se reusan tal cual.

El pipeline queda:

1. **Cliente** valida MIME (whitelist expandida) + tamaño (≤ 10 MB). Si **es imagen**, flujo de `020` sin cambios (genera thumb WebP con Canvas, extrae `width`/`height`). Si **no es imagen**, saltea `generateThumb()` — el multipart lleva solo el `original`.
2. **Server** revalida contra la whitelist expandida. Sube el `original` al bucket; si viene `thumb`, también lo sube. Inserta la fila con `thumb_object_key`/`width`/`height` **nullable** para los no-imagen.
3. **Panel** detecta `isImageMime` por fila: imagen → `ThumbnailCard` (`020` sin cambios); no-imagen → nueva `DocumentCard` con ícono por tipo + nombre + tamaño + metadata. Click en imagen abre lightbox; click en no-imagen dispara descarga vía signed URL con `?download=1`.
4. **Signed-url handler** acepta `?download=1` que fuerza `Content-Disposition: attachment` (vía `createSignedUrl(path, 60*15, { download: originalFilename })` de Supabase Storage).

### Qs de la spec cerradas en el plan

- **Q-1 · Preview inline de PDFs:** **no**. Default aplicado. Click → descarga.
- **Q-2 · Distinguir `.doc` del `.docx`:** **no**, mismo ícono (Word azul). El server distingue via MIME; el usuario no necesita verlo.
- **Q-3 · Content-Disposition attachment para PDFs:** **sí, siempre**. Default confirmado por el usuario en la ronda inicial.
- **Q-4 · Magic bytes:** **no**. Default confirmado. MIME + extensión + `attachment` disposition cubren el vector real.
- **Q-5 · Límite por tipo diferenciado:** **no — 10 MB para todo**. Confirmado.
- **Q-6 · Iconos exactos de lucide:** `FileTextIcon` para PDF/Word; `FileSpreadsheetIcon` para Excel; `FileIcon` fallback. Los tonos se aplican como texto color (no fondo) via Tailwind utility classes del design system — `text-attention` (ámbar) para PDF, `text-primary` (azul) para Word, `text-success` (verde) para Excel, `text-muted-foreground` para fallback. Si en `DESIGN.md` esos tokens no existen, se usa `text-destructive`/`text-primary`/`text-emerald-600`/`text-muted-foreground` como fallback literal.
- **Q-7 · Orden del panel:** **cronológico puro** (`created_at` asc), igual que `020`. El ícono alcanza para distinguir imagen de doc.

### AC de la spec que se ajustan

- **AC-2.1 (card compacta):** el layout de la card de documento no es cuadrada como el placeholder de upload, sino un rectángulo horizontal — se adapta mejor a nombres largos de archivo. Aspect-ratio aproximado `3/2`. La grilla del panel sigue siendo responsive multi-columna (igual que `020`); las imágenes tienen aspect-ratio dinámico por `width`/`height`, las docs tienen el `3/2` fijo.
- **AC-3.3 (`?download=1`):** el cliente **siempre** pasa `?download=1` para no-imagen; para imagen, solo cuando el usuario clickea "Descargar" en el lightbox (en el thumb y en el view del lightbox se sirve sin download para que `<img>` renderice).

---

## 2. Modelo de datos

**Una migration aditiva pura**, archivo `supabase/migrations/00000000000023_attachment_doc_types.sql`:

```sql
-- Feature 025: docs y PDFs en adjuntos de tickets. Extiende 020.
--
--   - thumb_object_key, width, height pasan a nullable — los no-imagen no
--     tienen thumb ni dimensiones.
--   - size_bytes check sube de 5 MB a 10 MB.
--
-- Aditiva pura: no toca filas existentes, no reescribe RLS, no cambia triggers
-- ni grants.

alter table public.ticket_attachments
  alter column thumb_object_key drop not null,
  alter column width drop not null,
  alter column height drop not null;

alter table public.ticket_attachments
  drop constraint ticket_attachments_size_bytes_check;

alter table public.ticket_attachments
  add constraint ticket_attachments_size_bytes_check
  check (size_bytes > 0 and size_bytes <= 10485760);
```

**Nota sobre el nombre del constraint.** Postgres genera `<table>_<col>_check` por default cuando el `check` se declara inline en el `create table`. El `20` migration tiene `check (size_bytes > 0 and size_bytes <= 5242880)` inline — eso produce `ticket_attachments_size_bytes_check`. El `drop constraint` lo asume. Si en algún entorno el nombre quedó distinto, la migration falla ruidoso y se corrige con el nombre real (chequeable con `\d+ ticket_attachments` o `pg_constraint`).

**Regla de dos fases (CLAUDE.md).** La migration es:

- **Agregar sin romper.** `thumb_object_key`/`width`/`height` pasan a nullable → el código viejo que las lee no se rompe (siguen devolviendo valores no-null para las filas que ya existen de `020`). El `check` nuevo es más laxo → ningún archivo existente lo viola.
- **No requiere fase 2 posterior.** No se borra ninguna columna ni índice. La migration es terminal.
- **Orden recomendado del deploy:**
  1. `pnpm db:push` contra el proyecto de Supabase (migration 23).
  2. Push del código 025 a `main` → Vercel deploya.

  El código de 020 deployado sigue funcionando sin enterarse del cambio porque las columnas nullable aceptan los mismos inserts que antes.

---

## 3. Phase 1 — Migration (T1.1 – T1.2)

- Crear `supabase/migrations/00000000000023_attachment_doc_types.sql` con el SQL de arriba.
- Aplicar con `pnpm db:push` en el momento del deploy.
- `pnpm db:types` para regenerar `src/types/database.ts` — las tres columnas pasan a `string | null` / `number | null`.

Verificación post-migration: `select column_name, is_nullable, data_type from information_schema.columns where table_name = 'ticket_attachments' and column_name in ('thumb_object_key', 'width', 'height')` → las tres `YES` en `is_nullable`.

---

## 4. Phase 2 — Shared layer: types + validador (T2.1 – T2.3)

### 4.1 `src/lib/attachments/types.ts`

Expansión en 6 lugares:

```ts
export const ATTACHMENT_MIME_TYPES = [
  // Imágenes (020)
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  // Documentos (025)
  "application/pdf",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
] as const;

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB (bump desde 5 MB)
```

**Nuevos exports:**

```ts
const IMAGE_MIME_TYPES = new Set<AttachmentMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function isImageMime(mime: string): mime is AttachmentMimeType {
  return (IMAGE_MIME_TYPES as Set<string>).has(mime);
}

type AttachmentIconKind = "image" | "pdf" | "word" | "excel" | "file";

export function iconForMime(mime: AttachmentMimeType): { kind: AttachmentIconKind; tone: string } {
  if (isImageMime(mime)) return { kind: "image", tone: "text-muted-foreground" };
  if (mime === "application/pdf") return { kind: "pdf", tone: "text-destructive" };
  if (mime === "application/msword" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return { kind: "word", tone: "text-primary" };
  }
  if (mime === "application/vnd.ms-excel" || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return { kind: "excel", tone: "text-emerald-600 dark:text-emerald-400" };
  }
  return { kind: "file", tone: "text-muted-foreground" };
}
```

El panel mapea `kind` a un ícono concreto de `lucide-react` (`FileTextIcon` para pdf/word, `FileSpreadsheetIcon` para excel, `FileIcon` para fallback, `ImagePlusIcon` para image upload placeholder). Mantener el mapeo en el componente (no en `types.ts`) para que la librería de iconos quede como detalle de UI, no de dominio.

**Cambio en `extensionForMime`:**

```ts
export function extensionForMime(mime: AttachmentMimeType): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "application/pdf": return "pdf";
    case "application/msword": return "doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
    case "application/vnd.ms-excel": return "xls";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return "xlsx";
  }
}
```

**Cambio en `buildObjectKey`:**

```ts
export function buildObjectKey(
  ticketId: string,
  attachmentId: string,
  filename: string,
  mime: AttachmentMimeType,
): { objectKey: string; thumbObjectKey: string | null } {
  const slug = slugifyFilename(filename);
  const ext = extensionForMime(mime);
  const objectKey = `tickets/${ticketId}/original/${attachmentId}-${slug}.${ext}`;
  const thumbObjectKey = isImageMime(mime)
    ? `tickets/${ticketId}/thumb/${attachmentId}-${slug}.webp`
    : null;
  return { objectKey, thumbObjectKey };
}
```

**Comentario del archivo** actualizado: la nota sobre "cualquier tipo nuevo que se quiera aceptar en el futuro" se agranda explicando que ahora cubre imagen y documento.

### 4.2 `src/lib/validation/attachments.ts`

El `parseAttachmentUploadForm` actual exige `thumb`, `width` y `height` como requeridos. Ajuste:

- Si `original.type` es imagen → thumb/width/height **requeridos** (mantiene comportamiento de `020`).
- Si no es imagen → thumb/width/height **ignorados** (si vienen, se descartan).
- El error de "pasa el límite (5 MB)" se parametriza a `${MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024} MB` para no mentir después del bump.

Nuevo tipo de retorno:

```ts
export type ParsedAttachmentUpload = {
  original: File;
  thumb?: File;
  width?: number;
  height?: number;
};
```

### 4.3 Verificación

`pnpm typecheck` tiene que seguir verde. El cambio del tipo de retorno de `buildObjectKey` (`string | null` en `thumbObjectKey`) va a mostrar errores en el único call site (handler POST) → se arregla en Phase 3.

---

## 5. Phase 3 — Server: handler POST + signed-url (T3.1 – T3.3)

### 5.1 `src/app/api/tickets/[id]/attachments/route.ts`

Bifurcación por `isImageMime`:

```ts
const originalMime: AttachmentMimeType = original.type;
const isImage = isImageMime(originalMime);

// Validar que thumb está si es imagen, ausente si no.
if (isImage && !thumb) {
  return NextResponse.json({ error: "El thumbnail es requerido para imágenes" }, { status: 400 });
}

// ... UUID + paths
const { objectKey, thumbObjectKey } = buildObjectKey(ticket.id, attachmentId, original.name, originalMime);

// Upload: original siempre, thumb solo si imagen.
const originalUpload = await admin.storage.from(ATTACHMENT_BUCKET).upload(objectKey, original, {
  contentType: originalMime,
  upsert: false,
});
if (originalUpload.error) { /* return 500 */ }

if (isImage && thumb && thumbObjectKey) {
  const thumbUpload = await admin.storage.from(ATTACHMENT_BUCKET).upload(thumbObjectKey, thumb, {
    contentType: thumb.type,
    upsert: false,
  });
  if (thumbUpload.error) {
    await admin.storage.from(ATTACHMENT_BUCKET).remove([objectKey]).catch(() => undefined);
    return NextResponse.json(/* 500 */);
  }
}

// Insert con nullables:
const insertPayload: TicketAttachmentInsert = {
  id: attachmentId,
  ticket_id: ticket.id,
  project_id: ticket.project_id,
  object_key: objectKey,
  thumb_object_key: thumbObjectKey, // null para no-imagen
  original_filename: original.name,
  mime_type: originalMime,
  size_bytes: original.size,
  width: isImage ? width! : null,
  height: isImage ? height! : null,
  uploaded_by: viewer.id,
};
```

Cleanup del original si el insert falla también funciona igual: `remove([objectKey])` si no hay thumb, o `remove([objectKey, thumbObjectKey])` si lo hay.

### 5.2 `src/app/api/tickets/[id]/attachments/[attachmentId]/signed-url/route.ts`

Agregar soporte para `?download=1`:

```ts
const downloadParam = url.searchParams.get("download") === "1";

// ... después del `attachment` fetched:
if (variant === "thumb" && !attachment.thumb_object_key) {
  return NextResponse.json({ error: "Este adjunto no tiene thumbnail" }, { status: 404 });
}

const targetPath = variant === "original" ? attachment.object_key : attachment.thumb_object_key!;

const signOptions = downloadParam
  ? { download: attachment.original_filename }
  : undefined;

const { data: signed, error: signError } = await supabase.storage
  .from(ATTACHMENT_BUCKET)
  .createSignedUrl(targetPath, SIGN_EXPIRES_SECONDS, signOptions);
```

**Añadir `original_filename` al select** del attachment:

```ts
.select("id, ticket_id, object_key, thumb_object_key, original_filename")
```

### 5.3 Verificación

- `pnpm typecheck` verde.
- Smoke manual: subir una imagen → sigue andando como en 020. Subir un PDF → fila con `thumb_object_key=null`.

---

## 6. Phase 4 — Cliente: upload.ts (T4.1 – T4.2)

### 6.1 `src/lib/attachments/upload.ts`

Bifurcación en `uploadTicketAttachment`:

```ts
const isImage = isImageMime(file.type);

const form = new FormData();
form.append("original", file, file.name);

if (isImage) {
  let thumb;
  try {
    thumb = await generateThumb(file);
  } catch (error) { /* return error */ }
  form.append("thumb", thumb.blob, `${file.name}.webp`);
  form.append("width", String(thumb.width));
  form.append("height", String(thumb.height));
}
// Si no es imagen, el multipart lleva solo `original`.
```

### 6.2 `fetchAttachmentSignedUrl` con parámetro `download`

Agregar un parámetro opcional:

```ts
export async function fetchAttachmentSignedUrl(
  ticketId: string,
  attachmentId: string,
  variant: "thumb" | "original" = "thumb",
  options?: { download?: boolean },
): Promise<string | null> {
  const params = new URLSearchParams({ variant });
  if (options?.download) params.set("download", "1");
  const response = await fetch(
    `/api/tickets/${ticketId}/attachments/${attachmentId}/signed-url?${params}`,
  );
  // ...
}
```

---

## 7. Phase 5 — UI panel (T5.1 – T5.4)

### 7.1 Button + helper text

- `ImagePlusIcon` → `PaperclipIcon` (o `UploadIcon`).
- `"Subir imagen"` → `"Subir archivo"`.
- Helper text actualizado: `"Hasta ${formatBytes(MAX_ATTACHMENT_SIZE_BYTES)} por archivo · imágenes, PDF, Word, Excel"` (automáticamente dice "10 MB" al cambiar la constante).

### 7.2 Renderer condicional

En el `.map(attachments)` del panel, bifurcar:

```tsx
{initialAttachments.map((attachment, index) =>
  isImageMime(attachment.mimeType) ? (
    <ThumbnailCard
      key={attachment.id}
      ticketId={ticketId}
      attachment={attachment}
      onOpen={() => openLightbox(index)}
      onDelete={canDelete ? () => handleDelete(attachment) : undefined}
    />
  ) : (
    <DocumentCard
      key={attachment.id}
      ticketId={ticketId}
      attachment={attachment}
      onDelete={canDelete ? () => handleDelete(attachment) : undefined}
    />
  ),
)}
```

### 7.3 Nueva subcomponente `DocumentCard`

Dentro del mismo archivo, debajo de `ThumbnailCard`:

```tsx
function DocumentCard({
  ticketId,
  attachment,
  onDelete,
}: {
  ticketId: string;
  attachment: TicketAttachmentSummary;
  onDelete?: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const { kind, tone } = iconForMime(attachment.mimeType as AttachmentMimeType);
  const Icon = iconComponentForKind(kind); // FileTextIcon / FileSpreadsheetIcon / FileIcon

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const url = await fetchAttachmentSignedUrl(ticketId, attachment.id, "original", { download: true });
      if (!url) {
        alert("No se pudo generar el link de descarga");
        return;
      }
      // navegar fuerza la descarga (Supabase devuelve attachment disposition)
      window.location.assign(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="group border-border bg-surface relative overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={handleDownload}
        className="focus-visible:outline-ring block w-full outline-none focus-visible:outline-2 aspect-[3/2] flex items-center justify-center"
        aria-label={`Descargar ${attachment.originalFilename}`}
        disabled={downloading}
      >
        <Icon className={cn("size-12", tone)} aria-hidden="true" />
      </button>

      {onDelete && (
        <button /* mismo botón X que ThumbnailCard */ />
      )}

      <div className="border-border border-t px-2 py-1.5">
        <p className="text-caption truncate" title={attachment.originalFilename}>
          {attachment.originalFilename}
        </p>
        <p className="text-caption text-muted-foreground">
          {formatBytes(attachment.sizeBytes)}
          {attachment.uploadedByName && ` · ${attachment.uploadedByName}`}
        </p>
      </div>
    </div>
  );
}

function iconComponentForKind(kind: "pdf" | "word" | "excel" | "file" | "image") {
  switch (kind) {
    case "pdf":
    case "word":
      return FileTextIcon;
    case "excel":
      return FileSpreadsheetIcon;
    case "image":
      return ImageIcon;
    default:
      return FileIcon;
  }
}
```

### 7.4 Lightbox: skip para no-imagen

El `openLightbox(index)` solo se llama desde `ThumbnailCard`. Las docs tienen su propio handler (`handleDownload`). El `<Lightbox>` no necesita cambios — ya solo se abre para índices de imágenes.

**Edge case:** el navegador de flechas del Lightbox salta a la imagen siguiente/anterior. Si el ticket tiene docs intercalados con imágenes (`[img, doc, img, doc, img]`), navegar con flecha "siguiente" desde el primer `img` debería ir al tercer item que es el siguiente `img`, no al `doc`. **Decisión:** se mantiene el comportamiento simple (saltar al siguiente índice sin filtrar); si cae en una doc, el lightbox se cierra visualmente (no hay URL para renderizar) — bug menor que se arregla en una iteración futura si molesta. Como el panel ordena por `created_at` y suele agrupar imágenes/docs por tanda, en la práctica se nota poco. Anotarlo como F3 en tasks.

---

## 8. Phase 6 — Tests + Cierre (T6.1 – T6.4)

### 8.1 Tests unit

Un solo archivo `tests/unit/attachments-doc-types.test.ts`:

- `isImageMime` para los 9 MIME types (4 true, 5 false).
- `iconForMime` para los 9 MIME types + un string random (fallback).
- `extensionForMime` para los 5 nuevos tipos.
- `buildObjectKey` con un MIME imagen → `thumbObjectKey` no null; con un MIME doc → `thumbObjectKey` null.

Decisión explícita: **no** se agregan tests de integración ni smoke. Mismos criterios que `020` plan §6.2 (y 021): el handler es un refactor local sobre pipeline ya testeado por `020`.

### 8.2 Cierre

- Marcar 025 como `done` en `specs/features/README.md`.
- CLAUDE.md: sumar al bullet de 020/025 que la whitelist se expandió. El bullet actual de 020 en Estado de features dice "solo imágenes" — reemplazar o complementar.
- Verificación visual del usuario (T6.4):
  - Subir un PDF, Word y Excel al ticket.
  - Verificar que la card muestra ícono + nombre + tamaño.
  - Click en la card → descarga con el nombre original (abrir en Finder/Explorer verifica).
  - Subir una imagen → sigue abriendo thumbnail + lightbox como antes.
  - Borrar un adjunto propio (PDF) → funciona.
  - Un contributor sube un PDF; un PM borra el adjunto → funciona.
  - Correr `pnpm test:unit` → verde.

---

## 9. Deps

**Sin cambios.** Todo lo necesario ya está:

- `lucide-react` para los íconos nuevos (`FileTextIcon`, `FileSpreadsheetIcon`, `FileIcon` ya exportados por la lib que ya está instalada).
- Supabase JS tiene soporte para el flag `{ download: filename }` en `createSignedUrl` desde v2.

Zero deps nuevas.

---

## 10. Riesgos revisitados

Los R-1 a R-8 de la spec siguen vigentes. Actualizaciones del plan:

- **R-3 · Archivo mal nombrado:** el serving con `attachment` disposition **más** la validación de MIME contra la whitelist dejan el vector residual contenido en "ejecutable renombrado como PDF cuyo MIME declarado es `application/pdf`". Para ese caso, la mitigación es (a) confianza del equipo y (b) opcional en el futuro: sumar `file-type` lib para validar magic bytes server-side. Decidido no en MVP.
- **R-4 · Bump 5→10 MB:** las dos columnas con check (`size_bytes <= 5242880`) se reescriben con `size_bytes <= 10485760`. Los archivos existentes de 020 son todos ≤ 5 MB → siguen siendo válidos. Thumbs seguirán generándose en cliente al mismo tamaño que antes (300px WebP ~25 KB) incluso si el original pasa de 10 MB (dentro del límite nuevo).
- **R-8 · Lightbox con docs intercalados:** aceptado — ver §7.4. Anotado como F3.

### Riesgo nuevo del plan

- **R-9 · El nombre del constraint check.** Si por alguna razón el `ticket_attachments_size_bytes_check` quedó con otro nombre en producción (p.ej. porque la migration original se corrió con un rename posterior), el `drop constraint` de la migration 23 falla. **Mitigación:** antes del `db:push`, consultar `select conname from pg_constraint where conrelid = 'ticket_attachments'::regclass and contype = 'c'` en el proyecto de Supabase. Si el nombre difiere, actualizar la migration con el nombre real. En caso de desastre durante el push, revertir con `alter table ... add constraint ticket_attachments_size_bytes_check check (size_bytes > 0 and size_bytes <= 5242880)` y re-pensar.

---

## 11. Migrations: numeración

La próxima migration es la **23** (`00000000000023_attachment_doc_types.sql`). Las 20-22 son `ticket_attachments`, `ticket_comments` y `status_change_notify_pm`.
