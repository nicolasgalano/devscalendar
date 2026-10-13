# Plan — Pegar imágenes en el editor rich text

- **ID:** 026-paste-image-in-rich-editor
- **Estado:** draft
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

Se agrega un `handlePaste` (y `handleDrop` paralelo) a las extensiones compartidas del editor Tiptap (`buildRichTextExtensions()`), que intercepta imágenes del clipboard/arrastradas, las sube via el endpoint existente `POST /api/tickets/:key/attachments` de `020`/`025` con un flag nuevo `source='paste'`, e inserta un nodo `image` (ya declarado en `RICH_TEXT_SCHEMA` desde `019`, hoy inerte) con `attrs.attachment_id` apuntando a la fila nueva. El viewer server-side (`renderDocToHtml`) resuelve los `attachment_id` en batch con la lista de adjuntos ya cargada para el panel, sin agregar queries. La tabla `ticket_attachments` suma una columna `source text default 'panel'` para distinguir uploads directos de pegados (metadato leve, no afecta RLS). Migration es aditiva pura (regla de dos fases trivialmente cumplida). Zero deps nuevas.

---

## 2. Arquitectura

```
┌───────────────────────────────────────────────────────────────┐
│  Editor (client, Tiptap)                                      │
│                                                                │
│   handlePaste(ClipboardEvent) ───┐                            │
│   handleDrop(DragEvent)      ───┤                            │
│                                   ▼                            │
│         src/lib/editor/paste-image.ts                         │
│         - detect image items                                   │
│         - URL.createObjectURL → placeholder node               │
│         - call useAttachmentUpload({ source: 'paste' })        │
│         - on success: replace placeholder with final node      │
│         - on error: remove placeholder + toast                 │
└──────────────────────────────┬────────────────────────────────┘
                                │ POST multipart
                                ▼
┌───────────────────────────────────────────────────────────────┐
│  POST /api/tickets/:key/attachments  (020/025, extended)      │
│                                                                │
│   - validate MIME (020 whitelist + 025 docs)                   │
│   - validate size (per-file + per-ticket)                      │
│   - validate `source` ∈ {'panel','paste'}  (default 'panel')  │
│   - insert row with source column                              │
│   - return { id, source, ... }                                 │
└──────────────────────────────┬────────────────────────────────┘
                                │ 201 Created
                                ▼
┌───────────────────────────────────────────────────────────────┐
│  Client resolves node attrs                                   │
│   - nodes.image.attrs.attachment_id = <uuid>                  │
│   - editor.commands.insertContent({ type: 'image', attrs })   │
│   - panel refetches via existing SyncIndicator pattern        │
└───────────────────────────────────────────────────────────────┘

─── Lectura ──────────────────────────────────────────────────────

┌───────────────────────────────────────────────────────────────┐
│  Server component: TicketDetail                                │
│                                                                │
│   const attachments = await getTicketAttachments(ticketId)    │
│                                                                │
│   <RichTextViewer                                              │
│      doc={ticket.description_doc}                              │
│      attachments={attachments}   ← nuevo prop                 │
│   />                                                           │
└──────────────────────────────┬────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│  renderDocToHtml(doc, { attachments })                        │
│                                                                │
│   - walk doc tree                                              │
│   - on `image` node:                                           │
│       lookup attachment by attrs.attachment_id in map          │
│       if found & attachment.ticket_id === ticketId:            │
│         emit <img src={signedUrl(attachment.thumb_object_key)}>│
│       else:                                                    │
│         emit <span class="…deleted">Imagen eliminada</span>    │
└───────────────────────────────────────────────────────────────┘
```

**Puntos clave:**

- **Un solo pipeline de upload** para paste, drop y botón del panel: `useAttachmentUpload()` nuevo que absorbe lo que hoy vive inline en `src/lib/attachments/upload.ts`. La parte del botón de panel se refactoriza para consumirlo sin cambios de UX.
- **La tabla `ticket_attachments` no referencia al doc.** La relación es `image.attrs.attachment_id` → `ticket_attachments.id`. Si se borra el adjunto, el nodo del doc queda huérfano y se renderiza como placeholder "eliminado" (coherente con `020/spec.md` R-9).
- **El renderer no hace queries.** Recibe la lista de adjuntos como prop. La lista se trae una sola vez para alimentar el panel; se reusa.
- **El flag `source` en el request** permite marcar la fila con cómo entró. Zero impacto en RLS, trigger de audit, o notificaciones (todos agnósticos a `source`).

---

## 3. Modelo de datos

### Cambios a tablas existentes

**Migration 24 — `ticket_attachments.source`:**

```sql
alter table public.ticket_attachments
  add column source text not null default 'panel'
  check (source in ('panel', 'paste'));

comment on column public.ticket_attachments.source is
  'How the attachment entered the ticket: ''panel'' (explicit upload button) or ''paste'' (pasted/dropped into the rich text editor). Informative only, no RLS or policy depends on this.';
```

- **Aditiva pura.** Las filas existentes de `020`/`025` toman `'panel'` por default (histórico correcto — vinieron del botón).
- Cumple la regla de dos fases trivialmente: la columna existe antes de que el código la lea; el código viejo que no la escribe sigue andando (default la cubre).
- Sin cambios en RLS, grants, triggers, policies — es columna informativa.

### Schema del nodo `image` en `RICH_TEXT_SCHEMA`

El nodo ya está declarado en `src/lib/editor/schema.ts` desde `019` pero sin uso real. Esta feature **expande sus attrs**:

```typescript
// Antes (019):
image: {
  attrs: {},                 // placeholder vacío
  // sin toolbar ni paste handler
}

// Después (026):
image: {
  attrs: {
    attachment_id: { type: 'string', required: true },  // uuid
    alt: { type: 'string', default: '' },
    width: { type: 'number', nullable: true },
    height: { type: 'number', nullable: true },
  },
}
```

El validador Zod (`src/lib/validation/rich-text.ts` + `src/lib/editor/validate.ts`) suma la rule: nodo `image` requiere `attachment_id` como string uuid. Rechaza nodos con `src` crudo (vector XSS si viniera de paste HTML).

### Nada más en DB

- No se agrega tabla.
- No se agregan índices (el lookup `attachment_id → attachment` se hace client-side por map, no por query).
- No se agregan triggers (los existentes de `020`/`025` para audit y notificación corren igual, agnósticos a `source`).
- No se agregan grants.

---

## 4. API surface

### Endpoint reusado (sin cambios de contrato)

**`POST /api/tickets/:key/attachments`** — ya existe desde `020`, extendido en `025`. Esta feature **suma un campo opcional** al multipart:

| Campo multipart | Tipo | Required | Default | Notas |
| :---- | :---- | :---- | :---- | :---- |
| `original` | File | sí | — | archivo original (misma whitelist de `020`+`025`) |
| `thumb` | File | sí si imagen | — | thumb WebP generado cliente (solo si es imagen) |
| `width` | string → number | sí si imagen | — | dimensiones del original (imagen) |
| `height` | string → number | sí si imagen | — | — |
| `source` | string | **no** | `'panel'` | `'panel'` o `'paste'`. Si llega otro valor, 400. |

**Backwards compat:** clientes viejos (el panel actual) no mandan `source`, y toma default `'panel'`. Nada se rompe.

**Response (sin cambios):**

```json
{
  "id": "uuid",
  "ticket_id": "uuid",
  "object_key": "...",
  "thumb_object_key": "...",
  "original_filename": "...",
  "mime_type": "...",
  "size_bytes": 123456,
  "source": "paste"
}
```

(La feature agrega `source` al response para que el cliente pueda renderizarlo en el badge sin ir a buscar.)

### Zod schema del body

```typescript
// src/lib/validation/attachment.ts (nuevo, o extensión del existente)
const AttachmentUploadMetaSchema = z.object({
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional(),
  source: z.enum(['panel', 'paste']).default('panel'),
});
```

### Nada más en API

- Los endpoints `DELETE` y `signed-url` de `020` se usan tal cual.
- El renderer server-side **no** es un endpoint — es una función pura (`renderDocToHtml`) invocada desde el server component `TicketDetail`.

---

## 5. Client — editor paste handler

### Archivo nuevo: `src/lib/editor/paste-image.ts`

```typescript
import type { Editor } from '@tiptap/core';
import { useAttachmentUpload } from '@/lib/attachments/use-upload';

/**
 * Factory que recibe el context del ticket (key + id) y devuelve un
 * handler compatible con Tiptap `editorProps.handlePaste`.
 *
 * Diseño: el handler es _factoría_ y no inline porque necesita closure
 * sobre el ticketKey, que viene del server component que monta el editor.
 */
export function createImagePasteHandler(opts: {
  ticketKey: string;
  onUploadStart: (localUrl: string) => string;   // devuelve node id transitorio
  onUploadComplete: (localUrl: string, attachmentId: string) => void;
  onUploadError: (localUrl: string, reason: string) => void;
}): (view, event) => boolean {
  return (view, event) => {
    const items = event.clipboardData?.items;
    if (!items || items.length === 0) return false;

    // Si hay texto en el clipboard, cedemos al handler default (AC-1.2).
    const hasText = Array.from(items).some(it => it.kind === 'string');
    if (hasText) return false;

    const imageFiles = Array.from(items)
      .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
      .map(it => it.getAsFile())
      .filter((f): f is File => f !== null);

    if (imageFiles.length === 0) return false;

    event.preventDefault();

    for (const file of imageFiles) {
      void uploadAndInsert(file, view, opts);
    }

    return true;
  };
}
```

El flujo detallado por archivo:

1. `URL.createObjectURL(file)` → preview local.
2. Insertar nodo `image` con `attrs.attachment_id = null` (temporario, placeholder) + `data-pending-url = <localUrl>`.
3. Llamar `useAttachmentUpload().upload(file, { source: 'paste', ticketKey })`.
4. Al completar: `transaction.setNodeMarkup(pos, undefined, { attachment_id: resp.id })`.
5. Al fallar: `transaction.delete(pos, pos + 1)` + toast + `URL.revokeObjectURL`.

### Archivo nuevo: `src/lib/editor/drop-image.ts`

Simétrico al paste, pero recibe `event.dataTransfer.files`. Si el file es imagen → mismo flujo. Si es doc permitido (`025`) → sube al panel con `source='panel'` (no viene del paste del editor, sino de un drop externo que podría ir a cualquier lado) + toast "Adjuntado al ticket".

**Decisión de diseño:** `source='panel'` para los docs dropeados porque conceptualmente **no son parte del texto**. El badge "paste" del panel debe reflejar "fue pegado/dropeado como contenido del texto"; un PDF dropeado no es texto. Esto se refina en implementación — alternativamente, podríamos tener un tercer valor `'drop'` pero añade complejidad para distinción cosmética.

### Archivo nuevo: `src/lib/attachments/use-upload.ts`

Hook que absorbe el upload. Firma propuesta:

```typescript
type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; file: File; progress: number }
  | { status: 'success'; attachment: AttachmentRow }
  | { status: 'error'; reason: string };

export function useAttachmentUpload(opts: {
  ticketKey: string;
}): {
  upload(file: File, meta: { source: 'panel' | 'paste' }): Promise<AttachmentRow>;
};
```

El panel actual (`<TicketAttachmentsPanel>` de `020`) se refactoriza para consumir este hook en lugar del código inline que tiene hoy. Cambio invisible para el usuario.

### Extensiones del editor — conexión

En `src/lib/editor/tiptap-extensions.ts`:

```typescript
export function buildRichTextExtensions(opts: {
  placeholder?: string;
  pasteImageContext?: { ticketKey: string };  // nuevo, opcional
}) {
  const base = [
    // ... todas las extensiones de 019/022
  ];

  if (opts.pasteImageContext) {
    base.push(
      ImageNode.configure({ inline: false }),
      // ...
    );
  }

  return base;
}
```

Y en `src/lib/editor/rich-text-editor.tsx`:

```typescript
<EditorContent
  editor={useEditor({
    extensions: buildRichTextExtensions({ 
      placeholder, 
      pasteImageContext: ticketKey ? { ticketKey } : undefined, // nuevo
    }),
    editorProps: {
      handlePaste: ticketKey ? createImagePasteHandler({...}) : undefined,
      handleDrop: ticketKey ? createDropHandler({...}) : undefined,
    },
  })}
/>
```

**Condicional por `ticketKey`:** si el editor se usa en un contexto donde no hay ticket (hipotético), no se activan los handlers. Resuelve Q-5 de la spec (crear ticket nuevo: no hay key, no hay paste).

---

## 6. Server — renderer

### Cambios a `src/lib/editor/render.ts`

El renderer actual (de `019`) convierte el doc jsonb a HTML string. Esta feature suma el caso del nodo `image`:

```typescript
export function renderDocToHtml(
  doc: RichTextDoc,
  opts: {
    mentions?: Map<string, string>;      // ya existe desde 022
    attachments?: Map<string, Attachment>; // nuevo
    ticketId?: string;                   // nuevo — para validar cross-tenant
  }
): string {
  // ... código existente
  
  case 'image': {
    const { attachment_id } = node.attrs;
    const att = opts.attachments?.get(attachment_id);
    
    // Si no está, está borrado o no tenemos permiso: placeholder.
    if (!att) return '<span class="deleted-attachment">Imagen eliminada</span>';
    
    // Cross-tenant check (R-3 de spec): el attachment debe pertenecer al mismo ticket.
    if (opts.ticketId && att.ticket_id !== opts.ticketId) {
      return '<span class="deleted-attachment">Imagen no disponible</span>';
    }
    
    const signedUrl = /* resolver via Supabase storage.from().createSignedUrl() */;
    return `<img src="${escape(signedUrl)}" data-attachment-id="${att.id}" alt="${escape(att.alt ?? '')}" />`;
  }
}
```

### El consumidor: `src/components/tickets/ticket-detail.tsx`

El server component que renderiza el detalle. Ya trae los adjuntos para el panel; esta feature los pasa también al viewer:

```typescript
const [attachments, mentions] = await Promise.all([
  getTicketAttachments(ticket.id),  // ya existe
  getTicketMentionsMap(ticket.description_doc, ticket.id),  // 022
]);

const attachmentsMap = new Map(attachments.map(a => [a.id, a]));

<RichTextViewer
  doc={ticket.description_doc}
  attachments={attachmentsMap}  // nuevo prop
  mentions={mentions}
  ticketId={ticket.id}
/>
```

**Sin queries nuevas.** El `getTicketAttachments` ya se llama para el panel. Se le pasa al viewer, se usa en el renderer. N+1 evitado por construcción.

### Signed URLs batch

El renderer necesita signed URLs para cada attachment en el doc. Son hits a `storage.from(...).createSignedUrl(...)` — no son DB queries, pero sí llamadas al API de Supabase storage. Dos opciones:

1. **Firmar al vuelo dentro del renderer** (una llamada por imagen). Simple, cada URL es independiente.
2. **Pre-firmar todas antes del render** y pasarlas en el map `attachments` ya con `signedThumbnailUrl` resuelto.

**Preferencia por 2:** se evita que el renderer (que es puro) tenga que ser async. Se hace una vez, en `ticket-detail.tsx`, en `Promise.all` con el resto de las queries. El renderer recibe el map ya resuelto.

```typescript
// Antes del render:
const attachmentsMap = new Map();
await Promise.all(
  attachments.map(async a => {
    const { data } = await supabase.storage
      .from('ticket-attachments')
      .createSignedUrl(a.thumb_object_key, 15 * 60);
    attachmentsMap.set(a.id, { ...a, signed_thumbnail_url: data?.signedUrl });
  })
);
```

Si falla la firma de alguna, el map tiene la fila sin URL → renderer emite "imagen no disponible". No frena el render.

---

## 7. UI — componentes

### Nuevos componentes

- **`<ImageUploadingPlaceholder>`** (`src/components/tickets/image-uploading-placeholder.tsx`):
  - Renderiza el `URL.createObjectURL(file)` como `<img>` con `opacity: 0.5` + spinner superpuesto.
  - Usado por el paste handler como node view mientras sube.

### Componentes modificados

- **`<RichTextEditor>`** (`src/lib/editor/rich-text-editor.tsx`):
  - Suma props `ticketKey` opcional.
  - Agrega handlers de paste/drop si `ticketKey` presente.
  - Suma un hint "Cmd+V para pegar screenshots" en el placeholder empty (AC-6.3).

- **`<RichTextViewer>`** (`src/lib/editor/rich-text-viewer.tsx`):
  - Suma prop `attachments: Map<string, Attachment>`.
  - El `<TaskItemHydrator>` sigue igual; se agrega lógica similar para re-attachar comportamiento al `<img>` del lightbox (opcional, en Phase 4).

- **`<TicketAttachmentsPanel>`** (`src/components/tickets/attachments-panel.tsx`):
  - Agrega badge visual sutil (ícono clipboard) en adjuntos con `source='paste'`.
  - Refactoriza el upload a `useAttachmentUpload()` (cambio interno, UX igual).

- **`<TicketDetail>`** (`src/components/tickets/ticket-detail.tsx`):
  - Agrega el `attachmentsMap` con `signedThumbnailUrl` resueltas y lo pasa a `<RichTextViewer>`.

- **`<TicketFormDialog>`** (`src/components/tickets/ticket-form-dialog.tsx`):
  - En modo "edición" pasa `ticketKey` al editor; en modo "creación" **no**, y el editor muestra un hint diferente ("Guardá el ticket primero para pegar imágenes") cuando se intenta.
  - Al confirmar, espera subidas en curso (AC-3.4) con el `useSyncIndicator()` global.

### Icons (lucide-react)

- `Clipboard` (ya instalado, para badge "paste").
- `ImageOff` (para placeholder "imagen eliminada" en el viewer).

---

## 8. Flow de deploy iterativo

Dividido en 5 phases, cada una mergeable y deployable sola:

1. **Phase 1 — Data & schema** (Migration 24 + types + extensión del nodo `image` en `RICH_TEXT_SCHEMA`). Zero UI; el editor sigue igual. Las filas existentes siguen funcionando.
2. **Phase 2 — API + validator + renderer** (endpoint acepta `source`; Zod lo valida; renderer sabe emitir `<img>` para nodos `image`). Zero UI de edit; el viewer puede renderizar nodos manualmente insertados (via SQL o un script), pero el editor del cliente no los emite todavía.
3. **Phase 3 — Hook unificado + paste handler** (`useAttachmentUpload`, `createImagePasteHandler`, placeholder; `<RichTextEditor>` recibe `ticketKey`). El panel se refactoriza a consumir el hook (cambio invisible). Primera versión funcional end-to-end del paste.
4. **Phase 4 — Drop handler + badge + hint + lightbox link** (drag-and-drop externo, badge "paste" en panel, hint en editor empty, click en imagen inline abre lightbox del panel).
5. **Phase 5 — Tests + cierre** (unit + integration + smoke; verificación manual; update `CLAUDE.md` + `specs/features/README.md`).

**Cada phase deployable sola.** Si Phase 1 sale a prod y Phase 2 todavía no, nada se rompe (el default de `source` cubre; el renderer no ve nodos `image` nuevos porque el editor no los emite).

---

## 9. Riesgos técnicos y mitigaciones

- **Edit race entre paste y confirmación (R-6 de spec):** aceptado. Si el PATCH responde 409 (`updated_at` mismatch), toast "Alguien más editó el ticket". El adjunto quedó en el panel; el usuario puede volver a abrir el editor y re-pegar (o insertar el nodo manualmente apuntando al `attachment_id` existente — no implementado en MVP, el usuario simplemente re-pega).
- **URL.createObjectURL leak (R-2):** mitigado con `useEffect` cleanup del placeholder componente.
- **Cross-tenant attachment_id (R-3/R-9):** el renderer valida `attachment.ticket_id === ticketId` antes de emitir `<img>`. Sin match, placeholder.
- **Validator Zod no exige existencia en DB (AC-7.4):** aceptado. El viewer resuelve correctamente ambos casos (existe → `<img>`, no existe → placeholder).
- **Resource cleanup para pending uploads al cancelar el diálogo:** aceptado como deuda, documentado en spec §5 "Fuera" como adjuntos huérfanos. Cleanup post-hoc puede hacerse con un cron si aparece acumulación.
- **Thumbnails no generados server-side (reuse de `020`):** el cliente genera thumb WebP ~300px. Si el usuario pega una imagen gigantesca (10 MB JPEG), el browser puede chokear al generar thumb. Mitigación: límite de 10 MB (de `025`) corta antes de llegar a eso.

---

## 10. Testing strategy

Alineado con `docs/testing.md`:

- **Unit (`tests/unit/`):**
  - `paste-image.test.ts`: handler recibe `ClipboardEvent` con image + text → cede; con solo image → insert pending node; con image + fail → remove node.
  - `drop-image.test.ts`: handler con file image → upload + insert; con doc → upload-only (no insert).
  - `rich-text-validator.test.ts`: nodo `image` sin `attachment_id` → rechazado; con `attachment_id` no-uuid → rechazado; válido → aceptado.
  - `render-image-node.test.ts`: renderer con attachment en map → emite `<img>` con signed URL; sin map → placeholder; cross-tenant → placeholder.

- **Integration (`tests/integration/`):**
  - `attachment-source-column.test.ts`: POST con `source='paste'` persiste; sin `source` default a `'panel'`; con `source='bogus'` → 400.
  - `rich-text-doc-with-image.test.ts`: insertar fila manualmente + doc con nodo `image` → render server-side devuelve `<img>` con URL firmada; borrar fila → render devuelve placeholder.

- **Smoke (`tests/smoke/`):**
  - `attachments-batch-fetch.test.ts`: la query de panel para `n` adjuntos es una sola query (no N+1).

- **E2E (`tests/e2e/`):**
  - Opcional MVP: `paste-image.spec.ts` que simula paste en el editor y verifica que aparece el nodo + fila. Playwright soporta `page.evaluate` para disparar `ClipboardEvent` sintéticos.

- **Manual** (prod, post-Phase 3):
  - Pegar screenshot en descripción nueva → nodo aparece inline con placeholder → upload → imagen renderiza → panel se actualiza.
  - Editar descripción vieja, pegar imagen al medio → funciona.
  - Pegar en comentario → funciona igual.
  - Borrar nodo del doc → adjunto queda en panel.
  - Borrar adjunto del panel → nodo del doc se renderiza como "eliminado".
  - Pegar imagen de 15 MB → toast de error, nodo no persiste.
  - Pegar en Chrome, Firefox, Safari — comportamiento consistente.

---

## 11. Deuda y seguimiento

- **Posible deuda nueva:** adjuntos "espurios" por paste en diálogos no confirmados (spec §5 "Fuera"). Si aparece acumulación medible, se evalúa un cron de GC. Se anota en `docs/deuda-tecnica.md` si pasa de hipotético a observado.
- **D-11 (del CLAUDE.md):** sigue vigente. `tickets.description` markdown fallback no se toca en esta feature.
- **No se abren nuevos ADRs.** Las decisiones de esta feature son extensiones naturales de `019`/`020`.
- **CLAUDE.md:** se agrega una nota corta en la sección "Editor rich text" explicando el nodo `image` ya activo y la relación con `ticket_attachments.source`. También en "Adjuntos" se menciona la nueva columna.
