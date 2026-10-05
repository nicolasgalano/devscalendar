# Plan — Adjuntos (imágenes) en tickets

- **ID:** 020-ticket-attachments
- **Spec reference:** `./spec.md`
- **Estado:** draft
- **Depende de:** `015-project-membership-and-tickets` (tabla `tickets`, RLS, `can_view_project`).

---

## 1. Resumen técnico

Se agrega una **tabla nueva `ticket_attachments`** y un **bucket privado de Supabase Storage** que hospeda dos objetos por adjunto: el original y un thumbnail WebP de ~300px. El thumb **se genera en el cliente** con Canvas antes del upload — cero server-side image processing, cero deps nuevas para redimensionar. El pipeline queda:

1. Cliente valida MIME + tamaño → genera thumb con Canvas → extrae `width`/`height` naturales → hace `POST /api/tickets/:key/attachments` con **ambos archivos** en un multipart y la metadata.
2. Server revalida MIME + tamaño (defensa en profundidad), sube los dos objetos al bucket con paths estructurados, inserta la fila en `ticket_attachments`.
3. Panel del detalle carga los thumbs vía URLs firmadas (15 min) y abre el original en lightbox al clickear.

**Sin notificaciones** al subir (decisión del user — spec §4 US-6 se **descarta** en el MVP). **Límite total del ticket es soft** — contador visible ("12 MB de 50 MB usados") pero sin bloqueo (spec AC-1.5 se **relaja**). El límite duro sigue siendo el por archivo (5 MB).

### Qs de la spec cerradas en el plan

- **Q-1 · Storage:** **Supabase Storage.** Bucket `ticket-attachments` privado, con policies que espejan `can_view_project`.
- **Q-2 · Thumbnails:** **cliente-side Canvas + WebP.** Cero deps, un helper `~40 líneas`. El thumb pesa ~25 KB vs. ~3 MB del original — 100× menos tráfico en el panel. Los dos archivos suben en el mismo POST multipart.
- **Q-3 · Un bucket para toda la app** con paths jerárquicos.
- **Q-4 · Nombre original tal cual** en la columna `original_filename`; el `object_key` es slug ASCII normalizado.
- **Q-5 · Adjuntos huérfanos por fallo parcial:** upload primero, insert después; si el insert falla, el server borra los dos objetos. Sin cleanup job (por ahora).
- **Q-6 · Retención al desactivar proyecto:** no se toca.
- **Q-7 · SVG:** **excluido**. La whitelist es `image/png`, `image/jpeg`, `image/webp`, `image/gif`.
- **Q-8 · Uploader solo en edición:** sí. Al crear un ticket, se cierra el diálogo y se abren los adjuntos desde el detalle.

### Decisiones nuevas del plan

- **Límite total soft con contador visible.** Sin `SELECT ... FOR UPDATE` (ya no hace falta la serialización — sin límite duro no hay race que atajar). El contador se calcula al render del panel con `SUM(size_bytes) WHERE ticket_id=`. Alerta visual al usuario cuando pasa 50 MB, pero sube igual.
- **Sin notificaciones.** Se saca `AC-6.*` y `US-6` de la spec. Ni trigger, ni copy en `notifications/events.ts`, ni row en `notifications`. Los interesados se enteran al abrir el ticket. Si aparece la necesidad, se suma después con el mismo patrón de `010`.
- **Dimensiones (width/height) se guardan.** Extraídas en cliente (Canvas ya conoce `naturalWidth`/`naturalHeight` del `<img>`), incluidas en el POST y guardadas en la tabla. Facilita el layout del lightbox (aspect-ratio) sin cargar el binario.

### AC de la spec que se relajan/eliminan

- **AC-1.5 (límite total 50 MB duro) → soft.** El client no bloquea el upload cuando el total supera 50 MB, muestra advertencia. El server no rechaza con 413 por límite total. El servidor sí rechaza por límite por archivo (AC-1.4).
- **AC-6.1, AC-6.2, AC-6.3 (notificaciones) → eliminadas del MVP.** Ni trigger, ni copy, ni row en `notifications`.
- **R-7 (concurrencia en el límite total) → descartado.** Sin límite duro no hay carrera.

---

## 2. Modelo de datos

### 2.1 Tabla `ticket_attachments`

Nueva. Migration `00000000000020_ticket_attachments.sql`.

```sql
create table public.ticket_attachments (
  id                 uuid primary key default gen_random_uuid(),
  ticket_id          uuid not null references public.tickets(id) on delete cascade,
  project_id         uuid not null references public.projects(id) on delete cascade,
  object_key         text not null,         -- path del original en el bucket
  thumb_object_key   text not null,         -- path del thumb WebP en el bucket
  original_filename  text not null,         -- nombre tal cual lo subió el user
  mime_type          text not null,         -- image/png|jpeg|webp|gif
  size_bytes         integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  width              integer not null check (width > 0),
  height             integer not null check (height > 0),
  uploaded_by        uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);

comment on table public.ticket_attachments is
  'Adjuntos (imágenes) de tickets — feature 020. Original y thumb WebP viven '
  'en el bucket privado `ticket-attachments`. El thumb se genera en cliente.';

create index ticket_attachments_ticket_id_idx on public.ticket_attachments (ticket_id);
create index ticket_attachments_project_id_idx on public.ticket_attachments (project_id);
```

**Decisiones:**

- **`project_id` denormalizado** — mismo patrón que `tickets`, `time_entries`, `sprints`. RLS por `can_view_project(project_id)` sin joins.
- **`on delete cascade` en las dos FKs.** Si un ticket se borra (hoy no pasa — `status='cancelled'`), sus adjuntos se van con él. Si un proyecto se borra (tampoco pasa — se desactivan), lo mismo. Consistente con `notifications` que también usa `on delete cascade` (excepción documentada en CLAUDE.md).
- **`uploaded_by on delete set null`** — desactivar/borrar un usuario nunca puede bloquear la limpieza; el adjunto queda como "subido por —" en la UI.
- **`size_bytes` con `check ≤ 5 MB`** — hard limit por archivo replicado en la base. El cliente y el server hacen su chequeo pero acá va como red final.
- **Sin `updated_at`** — los adjuntos no se editan (no hay campos mutables). Se suben, se ven, se borran.
- **`width`/`height`** — enteros positivos. Se usan para calcular aspect-ratio en el lightbox sin descargar el binario.

### 2.2 RLS

```sql
alter table public.ticket_attachments enable row level security;

grant select, insert, delete on public.ticket_attachments to authenticated;

-- Read: cualquiera que ve el proyecto ve los adjuntos.
create policy "ticket_attachments: read"
  on public.ticket_attachments for select
  to authenticated
  using (public.can_view_project(project_id));

-- Insert: contributor+ del proyecto. La regla granular ("puedo editar este
-- ticket específico") vive en el handler API, no en RLS — misma razón que
-- `time_entries` en 016: `can_edit_ticket` depende de attrs del ticket
-- (creador/assignee) que la RLS podría chequear pero complica el sql.
create policy "ticket_attachments: insert"
  on public.ticket_attachments for insert
  to authenticated
  with check (
    public.role_in_project(project_id) in ('contributor', 'lead')
    or public.is_admin()
    or public.is_pm_of_project(project_id)
  );

-- Delete: autor + PM primario + admin.
create policy "ticket_attachments: delete"
  on public.ticket_attachments for delete
  to authenticated
  using (
    uploaded_by = auth.uid()
    or public.is_admin()
    or public.is_pm_of_project(project_id)
  );

-- Sin update.
```

- **Sin `on public.ticket_attachments update`** — no hay grant, no hay policy. Las filas son inmutables. Si en algún momento hace falta editar (renombrar, mover), se suma después.

### 2.3 Trigger de audit_log

Un trigger `audit_ticket_attachment_events` que escribe en `audit_log` en insert y en delete. **Delete conserva snapshot completo** (patrón de `time_entries` en 016 T*, útil si un PM/admin borra algo importante).

```sql
create or replace function public.audit_ticket_attachment_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'ticket_attachment', new.id, 'create', actor_id,
      jsonb_build_object(
        'ticket_id', new.ticket_id,
        'original_filename', new.original_filename,
        'size_bytes', new.size_bytes,
        'mime_type', new.mime_type
      )
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'ticket_attachment', old.id, 'delete', actor_id,
      jsonb_build_object(
        'ticket_id', old.ticket_id,
        'original_filename', old.original_filename,
        'size_bytes', old.size_bytes,
        'mime_type', old.mime_type,
        'uploaded_by', old.uploaded_by,
        'object_key', old.object_key,
        'thumb_object_key', old.thumb_object_key
      )
    );
    return null;
  end if;

  return null;
end;
$$;

create trigger ticket_attachments_audit
  after insert or delete on public.ticket_attachments
  for each row execute function public.audit_ticket_attachment_events();

revoke all on function public.audit_ticket_attachment_events() from public;
```

**No hay trigger de update** — la tabla no permite update por policy.

### 2.4 Bucket de Storage

Nuevo bucket `ticket-attachments`, privado (público false), sin CDN caché público. Se crea en la misma migration (o vía dashboard, según decisión operativa — Supabase Storage tiene SQL functions para esto).

**Path structure:**
- Original: `tickets/<ticket_id>/original/<uuid>-<slug>.<ext>`
- Thumb: `tickets/<ticket_id>/thumb/<uuid>-<slug>.webp`

Donde:
- `<ticket_id>` es el uuid del ticket (predecible pero irrelevante — el bucket es privado).
- `<uuid>` es el uuid del attachment (nuevo por upload — colisiona con probabilidad cero).
- `<slug>` es el nombre normalizado (max 40 chars, solo `[a-z0-9-_]`, extraído del `original_filename`).
- `<ext>` es la extensión inferida del MIME (`.png`/`.jpg`/`.webp`/`.gif`).

**RLS del bucket** (via `storage.objects` policies):

```sql
-- Read: cualquiera que ve el proyecto del ticket.
create policy "ticket-attachments: read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and exists (
      select 1
      from public.ticket_attachments ta
      where (ta.object_key = name or ta.thumb_object_key = name)
        and public.can_view_project(ta.project_id)
    )
  );

-- Insert / Delete: se hacen desde el server con service_role, no desde el
-- cliente. Sin policy para authenticated en insert/delete. El handler API
-- valida permisos y usa el cliente admin (`service_role`) para subir/borrar.
```

**Decisión clave:** el cliente NUNCA sube directo al bucket. Todo pasa por el handler `POST /api/tickets/:key/attachments` que:
1. Verifica permisos de escritura sobre el ticket (via `canEditTicket`).
2. Recibe el multipart con ambos archivos.
3. Sube al bucket con `service_role`.
4. Inserta la fila.

Signed URLs para read se piden al server (nunca al bucket directo) — hay un endpoint `GET signed-url` que valida permisos antes de firmar. Aunque el bucket tenga RLS de select, el cliente **no** tiene el token de storage para pedir directo (usa el token de auth del user, y storage.objects necesita el bucket API distinto). Por simplicidad y consistencia con el resto de la app, todo pasa por handler.

---

## 3. Endpoints

### 3.1 `POST /api/tickets/:key/attachments`

Nuevo. Recibe multipart, sube dos objetos, inserta la fila.

**Body** (multipart/form-data):
- `original` (File, requerido) — el archivo original (image/png|jpeg|webp|gif, ≤ 5 MB).
- `thumb` (File, requerido) — el thumbnail WebP generado en cliente.
- `width` (string number, requerido) — dimensión natural del original.
- `height` (string number, requerido) — dimensión natural del original.

**Validaciones:**
- Guard: `requireTicketAccess(key)` + `canEditTicket(...)`.
- MIME del `original` en la whitelist (`ATTACHMENT_MIME_TYPES` de `src/lib/attachments/types.ts`).
- MIME del `thumb` = `image/webp`.
- Tamaño del `original` ≤ 5 MB (hard).
- Tamaño del `thumb` ≤ 100 KB (defensa — un thumb de 300px WebP jamás pesa tanto; si viene un blob raro, se rechaza).
- `width`/`height` enteros positivos, cada uno ≤ 20000 (protege contra bombas de decompresión no detectadas).

**Flow:**
1. Validar todo el input.
2. Generar `attachment_id` (uuid), `object_key`, `thumb_object_key`.
3. Subir `original` al bucket → path `object_key`.
4. Subir `thumb` al bucket → path `thumb_object_key`.
5. Si alguno de los dos upload falla → intentar borrar el otro (best-effort), responder 500.
6. Insert en `ticket_attachments`.
7. Si el insert falla → borrar los dos objetos (best-effort), responder 500 (Q-5 de la spec).
8. Response 201 con `{ id, object_key, thumb_object_key, original_filename, mime_type, size_bytes, width, height, uploaded_by, created_at }` (sin las URLs firmadas — se piden aparte por seguridad).

**Errores:**
- 400 — validation fail (Zod issues).
- 403 — sin permiso para editar el ticket.
- 413 — archivo original > 5 MB.
- 415 — MIME fuera de la whitelist.
- 404 — ticket no encontrado.
- 500 — fallo de storage o DB.

### 3.2 `GET /api/tickets/:key/attachments/:id/signed-url?variant=thumb|original`

Nuevo. Devuelve una URL firmada del path pedido, con expiración 15 minutos.

**Query params:**
- `variant` = `thumb` (default) o `original`.

**Validaciones:**
- Guard: `requireTicketAccess(key)` (read).
- El `attachment.ticket_id` debe matchear el ticket de la URL (previene ver adjuntos de otro ticket por id).

**Response:**
```json
{ "url": "https://…/storage/v1/object/sign/…", "expires_at": "2026-…" }
```

### 3.3 `DELETE /api/tickets/:key/attachments/:id`

Nuevo. Borra la fila y los dos objetos del bucket.

**Validaciones:**
- Guard: `requireTicketAccess(key)`.
- Permiso: `uploaded_by = current user` OR `is_admin` OR `is_pm_of_project`.

**Flow:**
1. Traer la fila (para conocer `object_key`, `thumb_object_key`).
2. Validar permiso.
3. Borrar los dos objetos del bucket (`storage.remove([object_key, thumb_object_key])` — Supabase permite batch).
4. Borrar la fila (`delete from ticket_attachments where id = ...`).
5. El trigger `audit_ticket_attachment_events` guarda el snapshot.

**Orden:** primero los objetos, después la fila. Si los objetos fallan → la fila queda; el user reintenta. Si la fila falla después de borrar los objetos → adjunto huérfano en la tabla pero sin binario. Es un edge case aceptable (loguear a stderr; cleanup job futuro).

**Errores:**
- 403 — sin permiso.
- 404 — attachment no encontrado.
- 500 — fallo de storage o DB.

---

## 4. Librería cliente — thumbnails con Canvas

Nuevo archivo `src/lib/attachments/generate-thumb.ts`:

```ts
export type GeneratedThumb = {
  blob: Blob;         // WebP
  width: number;      // natural del original (para guardar en DB)
  height: number;
};

const MAX_SIDE = 300;
const WEBP_QUALITY = 0.8;

export async function generateThumb(file: File): Promise<GeneratedThumb> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible");
  ctx.drawImage(bitmap, 0, 0, w, h);
  
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY });
  return { blob, width: bitmap.width, height: bitmap.height };
}
```

**Trade-offs:**

- **`OffscreenCanvas`** es soportado en Chromium, Firefox y Safari 16.4+ (todos los targets de la app). Si un browser viejo cae, cae con un error visible y el user reintenta con otro browser — no vale la pena el fallback a `<canvas>` DOM.
- **`createImageBitmap`** es la API moderna, más rápida que `Image + onload` y evita issues con CORS. Soportada donde `OffscreenCanvas` lo está.
- **WebP `quality: 0.8`** — sweet spot típico para thumbs (visualmente indistinguible del original a ese tamaño, pesa ~25 KB para un 300×300).
- **Máx 300 px** — suficiente para el grid del panel (thumbs de 150×150 con retina 2x = 300 px del recurso). Si el original es más chico que 300 px, se sube tal cual (`scale = 1`) — no upscale.

Un archivo `src/lib/attachments/upload.ts`:

```ts
export async function uploadTicketAttachment(
  ticketKey: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<AttachmentDTO> {
  // 1. Validar cliente-side
  if (!ATTACHMENT_MIME_TYPES.includes(file.type)) throw new Error("Tipo no permitido");
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) throw new Error("Archivo > 5 MB");
  
  // 2. Generar thumb
  const thumb = await generateThumb(file);
  
  // 3. Armar multipart y postear
  const form = new FormData();
  form.append("original", file, file.name);
  form.append("thumb", thumb.blob, `${file.name}.webp`);
  form.append("width", String(thumb.width));
  form.append("height", String(thumb.height));
  
  const response = await fetch(`/api/tickets/${ticketKey}/attachments`, {
    method: "POST",
    body: form,
  });
  
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "No se pudo subir el archivo");
  }
  
  return response.json();
}
```

- **Progreso:** el spec pide "placeholder de subiendo…" (AC-1.3). En el MVP el progreso es all-or-nothing (fetch no expone progress upload sin `XMLHttpRequest`). Se muestra spinner por archivo, sin porcentaje. Si aparece el pedido, se cambia a `XMLHttpRequest` o `fetch` + `ReadableStream` en una feature futura.

---

## 5. Whitelist compartida — `src/lib/attachments/types.ts`

Único punto de verdad, consumido por cliente y server:

```ts
export const ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

export const ATTACHMENT_ACCEPT_ATTR = ATTACHMENT_MIME_TYPES.join(",");

export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const SOFT_TOTAL_PER_TICKET_BYTES = 50 * 1024 * 1024; // 50 MB — solo advertencia

// El thumb siempre es WebP
export const THUMB_MIME_TYPE = "image/webp" as const;
export const MAX_THUMB_SIZE_BYTES = 100 * 1024; // 100 KB — defensa

export function extensionForMime(mime: AttachmentMimeType): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
  }
}
```

---

## 6. UI — `<TicketAttachmentsPanel>`

Nuevo componente `src/components/tickets/ticket-attachments-panel.tsx` (client). Se monta en `<TicketDetail>` (`ticket-detail.tsx`) **debajo de la descripción y encima de "Horas cargadas"**.

### 6.1 Layout

```tsx
<section className="pt-6">
  <div className="flex items-baseline justify-between pb-3">
    <h2 className="text-section font-medium">Adjuntos</h2>
    <span className="text-caption text-muted-foreground">
      {formatBytes(totalBytes)} de 50 MB usados
      {totalBytes > SOFT_TOTAL_PER_TICKET_BYTES && (
        <span className="text-attention ml-2">· pasaste el aviso</span>
      )}
    </span>
  </div>
  
  {canUpload && <UploadButton onFilesSelected={handleUpload} />}
  
  {attachments.length === 0 ? (
    <p className="text-ui text-muted-foreground italic">Sin adjuntos.</p>
  ) : (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {attachments.map((att) => <ThumbnailCard key={att.id} attachment={att} />)}
    </div>
  )}
  
  <Lightbox {...lightboxState} />
</section>
```

### 6.2 `<ThumbnailCard>`

Cada card:
- Tile 150×150 con aspect-ratio del original (via `width`/`height` de la fila para reservar espacio antes de cargar el thumb — evita layout shift).
- Muestra el thumb via `<img src={signedThumbUrl}>` — la URL firmada se pide en un `useEffect` on mount.
- Hover: nombre truncado, tamaño legible, "hace X min" con `<time title>`.
- Botón "Borrar" (icono X arriba a la derecha) — visible solo si `canDeleteAttachment(attachment, viewer)`.
- Click en el thumb → abre lightbox.

### 6.3 `<Lightbox>`

- Overlay full-screen (fixed inset-0 con backdrop blur oscuro).
- Imagen original al tamaño del viewport, con letterbox.
- Flechas para navegar entre adjuntos + `Esc` para cerrar.
- Pide la signed URL `variant=original` on mount.
- La imagen se cachea en memoria del browser mientras el lightbox está abierto — evita re-pedirla al navegar.

### 6.4 Upload UX

Al elegir uno o varios archivos:
1. Validación cliente-side inmediata (MIME + tamaño). Si alguno falla, se muestra error inline debajo del botón y NO se suben los otros — el user corrige y reintenta.
2. Para cada archivo válido: se agrega un tile placeholder al grid con spinner "Subiendo…" y se dispara `uploadTicketAttachment` en paralelo.
3. Cuando resuelve: el placeholder se reemplaza por el thumb real.
4. Si falla: el placeholder muestra error, con botón "Reintentar" que dispara el upload otra vez.
5. **Sin lightbox durante upload** — el user no puede abrir un adjunto que todavía no terminó.

### 6.5 Permisos de UI

- **Ver:** cualquiera con `can_view_project` (heredado del ticket).
- **Subir:** `canEditTicket(viewer, ticket, project, roleInProject)` — mismo helper que ya usa `<TicketDetail>` para el botón "Editar".
- **Borrar propios:** cualquiera cuya `uploaded_by = viewer.id`.
- **Borrar ajenos:** admin + PM primario. Un `canDeleteAttachment(attachment, viewer, project)` centraliza la regla.

Los tres checks son UX. La verdad la tiene la RLS de `ticket_attachments`. Si por API se manda un DELETE sin permiso, responde 403.

---

## 7. Phases

### Phase 1 — Base (migration + storage + types)

- T1.1 · Migration `00000000000020_ticket_attachments.sql` con la tabla, sus indexes, RLS, trigger de audit y grants.
- T1.2 · Crear el bucket `ticket-attachments` privado (desde dashboard de Supabase, documentado en el commit; o vía SQL si Supabase Storage lo permite via función).
- T1.3 · Storage RLS: policy de select para authenticated (join con `ticket_attachments`).
- T1.4 · `pnpm db:push` + `pnpm db:types`.
- T1.5 · `src/lib/attachments/types.ts` con la whitelist, tamaños, helper `extensionForMime`.
- T1.6 · Helper `src/lib/attachments/permissions.ts` con `canDeleteAttachment` y `canUploadAttachment` (reuso de helpers existentes de tickets).

### Phase 2 — API

- T2.1 · Zod schemas en `src/lib/validation/attachments.ts` para el body del POST (con `.extract` desde `formData`).
- T2.2 · `POST /api/tickets/[key]/attachments/route.ts` — recibe multipart, valida, sube dos objetos, inserta. Usa `createClient` con service role para storage.
- T2.3 · `GET /api/tickets/[key]/attachments/[id]/signed-url/route.ts` — devuelve URL firmada (thumb o original).
- T2.4 · `DELETE /api/tickets/[key]/attachments/[id]/route.ts` — borra fila + objetos.
- T2.5 · Test integración mínimo (guard de permisos, RLS, delete cascade).

### Phase 3 — Lib cliente

- T3.1 · `src/lib/attachments/generate-thumb.ts` con `generateThumb(file)`.
- T3.2 · `src/lib/attachments/upload.ts` con `uploadTicketAttachment(ticketKey, file)`.
- T3.3 · Test unit del generador de thumb (fixture PNG de 800×600 → thumb WebP de max 300 px por lado, mantiene aspect-ratio).

### Phase 4 — UI

- T4.1 · `src/lib/attachments/format.ts` — `formatBytes(n)`, `canDeleteAttachment(...)`.
- T4.2 · `src/lib/tickets/query.ts` — sumar `attachments` al `TicketDetail` (SELECT con embed).
- T4.3 · `<ThumbnailCard>` — card con thumb + hover + botón borrar.
- T4.4 · `<Lightbox>` — overlay con navegación.
- T4.5 · `<TicketAttachmentsPanel>` — grid + upload + contador + lightbox.
- T4.6 · Integración en `<TicketDetail>` — importar y montar el panel.
- T4.7 · Copy y estilos: `DESIGN.md` — grid responsive, hover states, aspect-ratio con `width`/`height` para evitar layout shift.

### Phase 5 — Cierre

- T5.1 · Actualizar `specs/features/README.md` (021 tuvo que esperar; acá va la 020 en done).
- T5.2 · Actualizar `CLAUDE.md` (estructura del repo con `src/lib/attachments/`, sección "Convenciones de código > Adjuntos", estado de features).
- T5.3 · Verificación visual del usuario:
  - Subir un PNG y un JPEG grandes (~4 MB) — thumbs aparecen, originales abren en lightbox.
  - Subir dos archivos en paralelo — ambos placeholder mientras suben.
  - Subir un archivo de 6 MB — se rechaza cliente-side con mensaje.
  - Subir varios archivos hasta pasar 50 MB — advertencia visible, sigue subiendo.
  - Como contributor: puedo subir y borrar los míos.
  - Como PM primario: puedo borrar de otros.
  - Como viewer del proyecto (rol viewer): veo los thumbs y puedo abrir el lightbox.
  - Como no-miembro: no veo el panel (obvio: no veo el ticket).
  - Copiar la URL firmada de un thumb, abrirla en incógnito → 403.
  - Borrar un adjunto → desaparece del panel; refresh → sigue sin estar.

---

## 8. Migrations

Una sola: `00000000000020_ticket_attachments.sql`. Contiene:
- La tabla + indexes + comment.
- Las 3 policies de RLS (read / insert / delete).
- La policy de storage.objects (read).
- El trigger `audit_ticket_attachment_events` + su función.
- Grants a `authenticated`.

**Dos fases:** esta migration es puramente aditiva (tabla nueva, policies nuevas, bucket nuevo). No rompe nada del deploy anterior. Sale con `pnpm db:push` antes del deploy del código de 020.

---

## 9. Deps

**Cero deps nuevas.**

- Canvas + WebP export → API del browser nativa (`createImageBitmap`, `OffscreenCanvas`, `convertToBlob`).
- Multipart upload → `FormData` nativo.
- Supabase Storage → `@supabase/supabase-js` ya está en el proyecto.

---

## 10. Riesgos revisitados

Los riesgos R-1 a R-9 de la spec siguen vigentes, excepto:

- **R-7 · Concurrencia en el límite total → DESCARTADO.** No hay límite duro; el contador es informativo.
- **R-9 · Fase 2 ciclo de vida** — se mantiene: la tabla no referencia al nodo del doc. La fase 2 futura suma un `attachment_id` al mark del nodo `image` en el JSON, no toca la tabla.

**Riesgos nuevos del plan:**

- **R-10 · `OffscreenCanvas` en browsers viejos.** Safari <16.4 y browsers que no lo tienen tiran al llamar `generateThumb`. **Mitigación:** el `upload.ts` captura la excepción y muestra un mensaje claro ("Tu navegador no soporta la generación de miniaturas. Actualizá o usá otro browser"). Sin fallback a `<canvas>` DOM — es maquinaria por 1% de los usuarios.
- **R-11 · Bomba de decompresión (imagen de 10 MB que decodifica a 4 GB).** El check `width` y `height` ≤ 20000 en el server ataja el caso obvio. Si el user manda un `width` mentiroso, el server no lo puede verificar sin decodificar el binario (que es justo lo que queremos evitar). **Mitigación aceptada:** riesgo residual chico dado que solo aceptamos MIMEs de imagen bien conocidos y el hard limit de 5 MB por archivo limita el daño.
- **R-12 · Thumb inconsistente con el original.** Si el cliente sube un thumb que no corresponde al original (bug o malicia), el server no puede detectarlo sin decodificar. **Mitigación:** aceptado como riesgo residual. El daño posible es "el lightbox muestra distinto al thumb" — cosmético, no de seguridad.
- **R-13 · Storage cost si el user sube muchos adjuntos.** Sin límite duro, el bill puede subir. **Mitigación:** el contador visible al pie del panel es la señal de alerta. Si aparece abuso, se puede sumar el hard limit después (una migration + revalidación server) o rate limiting por usuario/día.

---

## 11. Cierre

Al terminar:

1. Marcar 020 como done en `specs/features/README.md`.
2. Actualizar `CLAUDE.md`:
   - Estructura del repo: sumar `src/lib/attachments/` con los 5 archivos (`types.ts`, `generate-thumb.ts`, `upload.ts`, `format.ts`, `permissions.ts`).
   - Sección "Convenciones de código > Adjuntos": recordatorio del pipeline (cliente genera thumb + sube dos, server valida y sube al bucket con service_role, RLS del bucket espeja `can_view_project`).
   - Estado de features: línea para 020 done.
3. `docs/adr/` — no hace falta ADR nuevo. El pipeline es específico de esta feature; si se generaliza a otras entidades (comentarios, sprints) en el futuro, ahí se documenta.
4. Verificación visual del usuario (§ Phase 5.3).
