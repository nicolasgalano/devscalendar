# Spec — Documentos y PDF en adjuntos de tickets

- **ID:** 025-attachment-document-types
- **Estado:** draft
- **Referencias:** `020-ticket-attachments` (bucket privado, RLS, endpoints, panel, trigger de notificación, audit — todo se reusa). `015-project-membership-and-tickets` (permisos sobre tickets).

---

## 1. Objetivo

Extender el panel de adjuntos de `020` para que acepte **documentos y PDFs** además de imágenes. El equipo pide poder adjuntar al ticket: PDF, Word (`.doc`, `.docx`) y Excel (`.xls`, `.xlsx`). Los no-imagen se renderizan en el panel como **ícono por tipo + nombre + tamaño** (click → descarga, nunca inline). Toda la infra de storage, RLS, signed URLs, notificaciones y audit log de `020` **se reusa sin cambios estructurales** — es una extensión de whitelist + ajustes puntuales del renderer y del handler.

**Cambios de scope menores en el camino:**

- El **límite por archivo sube de 5 MB a 10 MB para todos los tipos** (incluye imágenes). El límite total por ticket (50 MB soft, contador visible, no bloquea) se mantiene.
- Las columnas `thumb_object_key`, `width`, `height` de `ticket_attachments` pasan a **nullable** — los no-imagen no tienen thumb.

**Fuera de scope (a propósito, se puede sumar después sin romper nada):**

- Preview inline de PDFs (pdf.js).
- Thumbnail server-side generado para la primera página de un PDF o doc.
- Tipos adicionales (PowerPoint, CSV, TXT, ZIP) — misma whitelist, sumar entries.
- Validación de magic bytes server-side (ver R-3 y Q-4).

---

## 2. Contexto

Desde `020` el panel de adjuntos acepta solo imágenes (`png`/`jpeg`/`webp`/`gif`, SVG excluido por XSS). El equipo reporta que el workflow real del cliente es mixto: una captura explica el bug, pero el **informe formal viene en PDF** y los **datos de prueba en Excel**. El workaround hoy es seguir usando Slack/Drive para esos archivos — que es exactamente el problema que `020` vino a resolver, con la salvedad de que no todos los archivos son imágenes.

**Por qué extender `020` en vez de empezar otra cosa.** La spec de `020` dejó explícitamente anotado el camino: *"Sumar tipos requiere agregar la entry al whitelist, decidir cómo se renderiza, y cero cambios en storage, RLS, endpoints o notificaciones."* Esta feature ejecuta exactamente ese programa. Lo único que no previó `020` fue que ciertos tipos **no tienen thumbnail** — y eso obliga a una micro-migration (nullable) y una bifurcación en el renderer del panel.

**Por qué subir el límite a 10 MB en el camino.** Un informe PDF del cliente (reporte de testing, orden de trabajo, resumen de resultados) suele pesar 5-8 MB sin ser excepcional. Mantener el límite en 5 MB forzaría al usuario a comprimir y nos acerca a lo que teníamos antes de `020` ("fijate si entra en Drive"). 10 MB resuelve el 99% de los casos sin esfuerzo y no cambia nada estructural — solo el `check` de la columna + la constante del cliente.

---

## 3. User stories

- **US-1 · Adjuntar documento** — Como miembro del proyecto con permiso de edición del ticket, quiero adjuntar PDFs y archivos de Office (Word, Excel) al ticket, para dejar informes y datos de prueba junto con la descripción sin tener que recurrir a Slack ni Drive.
- **US-2 · Ver qué tipo es de un vistazo** — Como cualquier miembro con permiso de lectura, quiero ver un ícono distintivo por tipo (PDF, Word, Excel) + el nombre y el tamaño, para distinguir de un vistazo qué es cada adjunto sin descargarlo.
- **US-3 · Descargar el archivo con el nombre original** — Como usuario que ve un adjunto no-imagen, quiero descargarlo con un click manteniendo el nombre original del archivo.
- **US-4 · Límite más generoso** — Como usuario que carga un informe PDF de 7 MB, quiero poder subirlo sin tener que comprimirlo — el límite debe acomodar documentos reales de la gestión, no solo screenshots.

---

## 4. Acceptance criteria

### US-1 · adjuntar documento

- **AC-1.1** — El selector de archivos del panel (`<input accept>`) acepta las 4 imágenes de `020` **más** cinco nuevos MIME types: `application/pdf`, `application/msword` (`.doc`), `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`), `application/vnd.ms-excel` (`.xls`), `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (`.xlsx`).
- **AC-1.2** — Al subir un archivo no-imagen, el cliente **no** llama a `generateThumb()`. El multipart manda solo el `original`, sin campos `thumb`, `width` ni `height`.
- **AC-1.3** — El server acepta multipart sin `thumb` cuando el `mime_type` del `original` es no-imagen. Si el tipo es imagen y falta el `thumb`, mantiene el comportamiento de `020` (rechaza con 400).
- **AC-1.4** — El límite por archivo pasa a **10 MB** para todos los tipos (imagen y no-imagen). Un archivo mayor es rechazado en cliente con "El archivo pesa más de 10 MB" y en server con 413. Las migrations hacen el check correspondiente en la columna.
- **AC-1.5** — El límite total por ticket se mantiene en 50 MB soft — contador visible, no bloquea (regla de `020`).
- **AC-1.6** — El server valida el `mime_type` del upload contra la whitelist expandida. Un tipo fuera de la whitelist devuelve 415 (misma política que `020`).

### US-2 · ver qué tipo es

- **AC-2.1** — En el panel, cada adjunto no-imagen se renderiza como una **card compacta** con: ícono grande por tipo, nombre original (truncado con ellipsis si es largo), tamaño formateado ("1.2 MB", "245 KB"), autor del upload + fecha relativa. Misma información que la card de imágenes, distinto layout.
- **AC-2.2** — Los iconos usan `lucide-react` (ya en el proyecto). Mapeo mínimo: PDF → ícono tipo "file-text" con tono rojo; Word (`.doc`/`.docx`) → "file-text" con tono azul; Excel (`.xls`/`.xlsx`) → "file-spreadsheet" con tono verde. Fallback para tipos futuros no mapeados → "file" neutro.
- **AC-2.3** — Los adjuntos de imagen siguen renderizándose como thumbnails WebP (comportamiento de `020` sin cambios).
- **AC-2.4** — Si un ticket tiene mezcla de imágenes y docs, se muestran todos en el mismo panel ordenados por `created_at` ascendente (regla de `020`). No hay separación visual por tipo — el ícono alcanza para distinguir.

### US-3 · descargar

- **AC-3.1** — Al clickear un adjunto no-imagen, el browser dispara descarga con `Content-Disposition: attachment` y el nombre original del archivo. **No se abre inline en el browser** — incluso un PDF se descarga, no se renderiza como viewer (ver AC-5.1 y Q-3).
- **AC-3.2** — Las imágenes mantienen el comportamiento de `020`: click → lightbox con preview inline + botón "Descargar".
- **AC-3.3** — El endpoint `GET /api/tickets/:id/attachments/:attachmentId/signed-url` acepta un query param `?download=1` que pide la URL firmada con el flag de descarga forzada. Para no-imágenes el cliente siempre pasa `download=1`; para imágenes depende del contexto (thumb vs download).

### US-4 · límite 10 MB

- **AC-4.1** — Una migration aditiva pura:
  - Hace nullable: `thumb_object_key`, `width`, `height` en `ticket_attachments`.
  - Modifica el `check` de `size_bytes <= 5MB` a `size_bytes <= 10MB`.
- **AC-4.2** — La constante `MAX_ATTACHMENT_SIZE_BYTES` en `src/lib/attachments/types.ts` sube a `10 * 1024 * 1024`.
- **AC-4.3** — Los adjuntos existentes de `020` (todos ≤ 5 MB) siguen siendo válidos — el nuevo check es más laxo, no revalida nada ya guardado.

### US-5 · RLS y seguridad

- **AC-5.1** — Todos los no-imagen (y PDFs específicamente) se sirven con `Content-Disposition: attachment` — el browser **nunca los renderiza inline**. Incluso si un PDF tuviera JavaScript embebido o un `.docx` tuviera macros, no se ejecutan en el contexto del browser.
- **AC-5.2** — El header `X-Content-Type-Options: nosniff` se mantiene en las respuestas de descarga (ya está en `020`).
- **AC-5.3** — La RLS, los permisos (uploader + PM primario + admin borran; contributor+ sube), el audit log con snapshot en delete y las notificaciones son **idénticos a `020`** — no se tocan en esta feature.

---

## 5. Alcance

**Dentro:**

- **Migration aditiva pura** (una sola, siguiendo la regla de dos fases cuando ya hay usuarios — ver "Migrations" en CLAUDE.md):
  - `alter column thumb_object_key drop not null`
  - `alter column width drop not null`
  - `alter column height drop not null`
  - `drop constraint ticket_attachments_size_bytes_check` + `add check (size_bytes <= 10485760)`.
- **`src/lib/attachments/types.ts`**:
  - Expandir `ATTACHMENT_MIME_TYPES` con los 5 nuevos.
  - Expandir `extensionForMime` con los 5 casos nuevos.
  - **Nueva** función `isImageMime(mime)` para que handler y panel bifurquen igual.
  - **`buildObjectKey`** devuelve `thumbObjectKey: null` para no-imagen (requiere cambiar el tipo de retorno).
  - **Nueva** función `iconForMime(mime)` que devuelve `{ icon: "file-text" | "file-spreadsheet" | "file", tone: "red" | "blue" | "green" | "neutral" }` o similar — consumida por el panel.
  - `MAX_ATTACHMENT_SIZE_BYTES` sube a 10 MB.
- **Handler POST** (`src/app/api/tickets/[id]/attachments/route.ts`):
  - Rama por `isImageMime`: si es imagen, flujo de 020 sin cambios; si no, acepta multipart sin `thumb`/`width`/`height` y escribe `thumb_object_key = null`.
- **Handler signed-url** (`src/app/api/tickets/[id]/attachments/[attachmentId]/signed-url/route.ts`):
  - Acepta `?download=1` para pedir a Supabase Storage la URL firmada con el flag de descarga forzada (`createSignedUrl(key, 60*15, { download: originalFilename })`).
- **`src/lib/attachments/upload.ts`** (cliente):
  - Si el tipo es imagen → flujo igual a 020 (genera thumb cliente-side con `generateThumb`).
  - Si no es imagen → arma el FormData sin `thumb`, `width`, `height`.
- **`src/components/tickets/ticket-attachments-panel.tsx`**:
  - Renderer condicional por `isImageMime`.
  - Nueva subcomponente (o rama inline) con la card de documento: ícono grande + nombre + tamaño + metadata.
  - Click en documento llama al endpoint signed-url con `?download=1`, obtiene URL, dispara navegación o `<a download>`.
- **Test unit** mínimo: `isImageMime`, `iconForMime`, `extensionForMime` para los nuevos tipos, `buildObjectKey` con tipo doc devolviendo `thumbObjectKey: null`.
- Actualización de `src/lib/validation/attachments.ts` si tiene algún refine que restrinja los tipos.

**Fuera:**

- **Preview inline de PDFs** (pdf.js, iframe de Google Docs Viewer, etc.). Ver Q-1.
- **Thumbnail server-side generado** (primera página del PDF, snapshot del docx). Requiere Edge Function con worker — scope totalmente aparte.
- **Más tipos** (PowerPoint, CSV, TXT, ZIP, formatos de video/audio). Fácil de sumar — misma whitelist.
- **Validación de magic bytes** (dep `file-type` o similar). Ver R-3 y Q-4.
- **Reorganizar panel por tipo** (imágenes arriba, docs abajo). Scope de UX separado si el panel se vuelve denso.
- **Cambios en la fase 2 pendiente de `020`** (paste de imagen al editor rich text). Esta feature no toca el nodo `image` del schema.
- **OCR, búsqueda por contenido, versionado de adjuntos.**

---

## 6. Preguntas abiertas

- **Q-1 · Preview inline de PDFs.** **Abierta, con default aplicado.** Default: **no**. Un embed de pdf.js suma ~300 KB al bundle del detalle de ticket, y la mayoría de los PDFs se van a descargar y abrir en Preview/Acrobat. Si llega pedido explícito, se evalúa con spec aparte.
- **Q-2 · Cómo diferenciar `.doc` del `.docx` en el ícono.** **Abierta, con default aplicado.** Default: **mismo ícono (Word azul)**. El server distingue vía `mime_type`; el usuario final no necesita verlo. Si aparece confusión, se suma un sub-badge con el formato.
- **Q-3 · `Content-Disposition: attachment` también para PDFs.** **Abierta, con default aplicado.** Default: **sí, siempre**. Para todos los no-imagen incluyendo PDFs. Mitiga el vector raro pero existente de PDFs con JS que algún viewer del browser podría ejecutar. Si el usuario quiere "preview rápido", lo abre descargado en su app por defecto. Decisión del usuario en la ronda de preguntas inicial.
- **Q-4 · Magic bytes.** **Abierta, con default aplicado.** Default: **no**. El bucket es privado + serving con `attachment` + path estructurado (`slugifyFilename` de `020`) evita traversal, y el vector residual (archivo con MIME correcto pero contenido falso, p.ej. ejecutable renombrado como `.pdf`) se desactiva por el serving como download. Para el volumen y perfil del equipo, el ROI de sumar `file-type` lib (~50 KB + código extra) no justifica. Decisión del usuario en la ronda inicial.
- **Q-5 · Límite por tipo diferenciado.** **Abierta, con default aplicado.** Default: **no — 10 MB para todo**. Un único límite mantiene la UX simple. Si aparece pedido de PDF de 20 MB que no se puede comprimir, se evalúa tabla por tipo.
- **Q-6 · Iconos exactos de lucide.** **Abierta, se decide en el plan.** Preferencia inicial: `FileTextIcon` para PDF/Word; `FileSpreadsheetIcon` para Excel; `FileIcon` fallback. Los tonos (rojo/azul/verde) se eligen en coordinación con `DESIGN.md` para que sean reconocibles sin romper el sistema de color.
- **Q-7 · ¿El panel ordena imágenes primero o cronológico puro?** **Abierta, con default aplicado.** Default: **cronológico puro (`created_at` asc)**, igual que `020`. El ícono alcanza para distinguir visualmente. Si el panel se vuelve denso con mezcla, se evalúa separar.

---

## 7. Riesgos

- **R-1 · Un documento con contenido malicioso descargado por un miembro.** Un contributor sube un PDF con exploit; otro miembro lo descarga y abre; se compromete su máquina. **Mitigación:** fuera del alcance de la app — los adjuntos viajan con la cadena de confianza del equipo (todos miembros autorizados), si aparece abuso se revoca al contributor y se borra el adjunto. A nivel app, `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` previenen ejecución inline en el browser; lo que haga el usuario destino con el archivo descargado es su responsabilidad.
- **R-2 · `.doc` legacy con macros autoexec.** Mismo que R-1 — no se ejecuta en el browser, se descarga. Word tiene su propio sandbox + alerta de macros. Fuera del alcance de la app.
- **R-3 · Archivo mal nombrado (binario con extensión `.pdf`).** Imposible desde el `<input accept>` + chequeo de MIME del browser; posible desde curl directo. El server valida `mime_type` contra la whitelist, pero no verifica que el contenido coincida con el MIME declarado. **Mitigación residual:** el archivo nunca se ejecuta inline (serving como download) y el `slugifyFilename` de `020` evita traversal del path. Para cerrar el vector del "falso PDF", se evaluaría `file-type` lib (Q-4) — decidido no sumar.
- **R-4 · El bump de 5 → 10 MB afecta imágenes también.** Un usuario que antes subía screenshots de 3-4 MB ahora puede subir de 8 MB sin bloqueo. Impacto en storage: cada ticket consume más. **Mitigación:** el límite total de 50 MB por ticket (soft, visible) contiene. Si aparece cost creep en Supabase Storage, se mira el bill y se ajusta (R-6 de `020` ya anticipaba esto).
- **R-5 · El panel se vuelve denso con mezcla imagen/doc.** Un ticket con 10 imágenes + 5 docs es un collage de thumbs y cards. **Mitigación:** scope de UX separado — no se preoptimiza. Si aparece el caso, se agrupa por tipo o se agrega "ver más" / paginación.
- **R-6 · Confusión entre `.doc` y `.docx` (y entre `.xls` y `.xlsx`).** Dos MIME types distintos para "lo mismo" según el usuario. **Mitigación:** el `extensionForMime` mapea cada MIME a su extensión canónica (`doc`, `docx`, `xls`, `xlsx`). El download llega con el nombre original del archivo tal cual lo subió el usuario — no se renombra. El ícono no distingue versiones (Q-2).
- **R-7 · Imagen con MIME legítimo pero contenido corrupto.** Un `.png` que no es un PNG válido. **Mitigación:** `020` ya lo cubre — `generateThumb` en cliente fallaría al construir el `ImageBitmap`, y el handler no requiere thumb para no-imagen (esta feature), así que un "fake imagen" quedaría rechazado al llegar al render del thumb. Nada nuevo aquí.
- **R-8 · Compatibilidad con fase 2 pendiente de `020` (paste al editor).** La fase 2 solo contempla imágenes al nodo `image` del editor. Esta extensión no abre el nodo `image` a docs — pegar un PDF al cuerpo del texto no tiene sentido. Las dos features conviven.

---

## 8. Dependencias

- **020-ticket-attachments** — dueña del bucket, RLS, trigger de notificación, audit log, endpoints base, panel. Esta feature **extiende**, no reemplaza. La migration de `025` es aditiva pura sobre la tabla y columnas de `020`.
- **015-project-membership-and-tickets** — permisos sobre el ticket (`can_edit_ticket`), mismo criterio que `020`.
- **010-notifications-and-audit** — se reusa `ticket_attachment_added` sin cambios. El copy ya menciona el nombre del archivo (cubre PDFs y docs).

---

## 9. Compatibilidad con features futuras

- **Preview inline de PDFs** (pdf.js, Google Docs Viewer). Se agrega condicionalmente en el panel sin cambiar el modelo. Zero migration.
- **Más tipos** (PowerPoint, CSV, TXT, ZIP). Sumar entries al whitelist + mapear íconos.
- **Thumbnail server-side de la primera página de PDF/doc.** Requiere Edge Function con conversor (LibreOffice headless, Ghostscript, etc.) o SaaS. Fuera de MVP; si entra, se puebla `thumb_object_key` para no-imagen también.
- **Fase 2 de `020` (paste al editor).** Solo imágenes, sigue ortogonal. No afecta esta extensión.
- **Validación de magic bytes.** Si aparece abuso, sumar `file-type` lib en el handler como defensa adicional. La whitelist por MIME + check de contenido se complementan.
- **Compresión server-side de imágenes al upload.** Si el bump a 10 MB causa cost creep, un paso de recompresión en el handler (Sharp o Edge Function) reduce peso sin cambiar el modelo.
