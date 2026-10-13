# Spec — Pegar imágenes en el editor rich text

- **ID:** 026-paste-image-in-rich-editor
- **Estado:** draft
- **Referencias:** `019-ticket-rich-editor` (schema `RICH_TEXT_SCHEMA`, nodo `image` declarado), `020-ticket-attachments` (tabla `ticket_attachments`, bucket, RLS, endpoints), `022-ticket-comments-and-mentions` (editor compartido entre descripción y comentarios), `025-attachment-document-types` (whitelist de MIME ampliada).

---

## 1. Objetivo

Permitir que el usuario pegue un **screenshot** del portapapeles directamente en el editor rich text del ticket (descripción y comentarios) y que la imagen quede **inline** en el texto donde está el cursor **y además** aparezca listada en el panel de **Adjuntos** del detalle. Es el pedido literal del equipo tras `020`/`025`: "quiero pegar un screenshot y que se agregue como adjunto", resuelto con modelo híbrido (Notion/Linear) — la imagen vive una sola vez en el bucket pero se ve en dos lugares que apuntan al mismo archivo.

---

## 2. Contexto

Hoy el equipo usa el panel de adjuntos de `020`+`025` para subir imágenes y documentos, pero quien reporta un bug con `Shift+Cmd+4` tiene que:

1. Guardar el screenshot al disco (`~/Desktop/Screenshot ...`).
2. Buscar el archivo en el panel de adjuntos.
3. Clickear "Subir imagen", seleccionar el archivo, confirmar.
4. Volver al editor y escribir "ver adjunto" o similar, porque la imagen no está en el flujo del texto.

Son 4 pasos para una acción que en Notion/Linear/Slack es un solo `Cmd+V`. El pedido del equipo pone esto en términos de productividad diaria — los tres bugs más frecuentes vienen con screenshot (ya lo decía `020/spec.md` §2), así que mover ese flujo a un paste directo tiene un impacto desproporcionado al tamaño de la feature.

`019` dejó explícitamente anotado que el nodo `image` del `RICH_TEXT_SCHEMA` está declarado "pero no se activa en la toolbar ni en el paste handler hasta que una feature futura decida qué hacer con él" (`src/lib/editor/schema.ts:62`). `020/spec.md` §9 cerró el diseño: la tabla `ticket_attachments` no referencia al doc, los nodos `image` del doc referencian al adjunto por `attachment_id`. Esta spec implementa esa fase 2.

**Por qué modelo híbrido (inline + panel) y no solo inline o solo panel:**

1. **El equipo pidió "que se agregue como adjunto" explícitamente** — es la señal de que el panel importa. Si solo quedara inline, un adjunto pegado no se vería en el panel y rompería la expectativa de "adjunto" como primitiva descargable y auditable.
2. **El flujo "mirá el adjunto 3 del panel" es cómodo** cuando la descripción es larga; verlo también inline sin perder el panel es lo mejor de los dos mundos.
3. **El panel es el única UI que lista todos los archivos del ticket** — incluye documentos de `025` que no se pueden pegar. Mezclar paste con uploads directos en el mismo panel mantiene consistencia visual.
4. **El modelo híbrido es exactamente lo que `020/spec.md` R-9 anticipó**. La tabla ya está diseñada para ambos usos sin cambios de schema.

**Por qué editor compartido (descripción Y comentarios):**

Desde `022`, el editor rich text es el mismo motor en los dos lugares (misma función `buildRichTextExtensions()`, mismo `RICH_TEXT_SCHEMA`). Encender paste en uno sin el otro sería incoherente — un usuario que acostumbra pegar en la descripción esperaría poder hacer lo mismo en comentarios, y al revés. El esfuerzo adicional es cero porque el handler vive en las extensiones compartidas.

---

## 3. User stories

- **US-1 · Pegar screenshot inline** — Como miembro del proyecto con permiso de edición del ticket (o cualquier `viewer+` en comentarios, ver `022`), quiero pegar un screenshot del portapapeles con `Cmd/Ctrl+V` en el editor rich text y que se inserte como imagen inline donde está el cursor, sin pasos adicionales.
- **US-2 · El paste también lo registra en Adjuntos** — Como quien pegó la imagen, quiero que esa misma imagen aparezca en el panel de Adjuntos del ticket, para que otros la vean listada junto con los uploads directos y la puedan descargar con nombre.
- **US-3 · Feedback inmediato durante la subida** — Como usuario que pega una imagen, quiero ver el nodo inline con un indicador de "subiendo…" (idealmente la imagen local pre-visualizada) mientras sube, y que se reemplace por la imagen definitiva al terminar — sin perder el cursor ni interrumpir mi tipeo.
- **US-4 · Si la subida falla, el nodo desaparece** — Como usuario, si la subida falla por tamaño, red o permisos, quiero que el nodo inline se remueva automáticamente y aparezca un mensaje breve ("No se pudo subir la imagen: …"); no quiero un placeholder roto que persista en el doc.
- **US-5 · Ver la imagen en el detalle (viewer server-side)** — Como lector del ticket, cuando abro el detalle quiero ver las imágenes inline en la descripción y comentarios resueltas a su versión completa, con la misma RLS que `020` — si no puedo ver el ticket, no veo las imágenes.
- **US-6 · Si borro el nodo del texto, el adjunto queda en el panel** — Como usuario que pegó una imagen y después decidió sacarla de la descripción, quiero que el adjunto siga disponible en el panel; borrar el nodo del doc no debe borrar el archivo (puede que lo quiera dejar como evidencia descargable).
- **US-7 · Si borro el adjunto desde el panel, los nodos del doc muestran "eliminado"** — Como PM/admin/autor que borra un adjunto desde el panel, acepto que los nodos `image` del doc que referenciaban ese adjunto queden visualmente marcados como "imagen eliminada" (placeholder) en el viewer; el doc no se auto-edita, pero muestra consistencia.
- **US-8 · El panel distingue uploads directos de pegados (metadato leve)** — Como quien revisa un ticket, quiero poder saber de un vistazo si un adjunto vino por paste o por el botón "Subir imagen" — útil para decidir si borrar algo "pegado por accidente". El metadato es informativo, no bloquea nada.

---

## 4. Acceptance criteria

### US-1 · pegar screenshot inline

- **AC-1.1** — Given estoy editando un ticket (descripción) o escribiendo un comentario, when hago `Cmd/Ctrl+V` con **una imagen en el portapapeles** (sin texto), then la imagen se inserta como nodo `image` en el doc en la posición del cursor, con `attrs.attachment_id` apuntando a la fila nueva en `ticket_attachments`.
- **AC-1.2** — Given el portapapeles tiene **imagen + texto** (típico cuando se copia desde un diseño), when pego, then **gana el texto** (comportamiento default de Tiptap `handlePaste` que ya existe para menciones); el paste de imagen requiere solo imagen en el clipboard. Esto evita destruir texto que el usuario estaba moviendo entre apps.
- **AC-1.3** — Given el portapapeles tiene **varias imágenes** (raro pero posible — ej. una app que exporta multi-screenshot), when pego, then se insertan **todas**, en orden, cada una como su propio nodo `image` con su propia fila en `ticket_attachments`. Cada subida es independiente — una que falle no aborta a las otras.
- **AC-1.4** — Given hago `Cmd/Ctrl+V` con **drag-and-drop file** (no clipboard — arrastro un archivo desde el Finder al editor), then **se inserta igual** (mismo pipeline). Si el archivo es imagen, va al editor; si es otro tipo permitido por `025` (PDF, Word, Excel), **no se inserta en el editor** sino que se agrega al panel de adjuntos (mismo endpoint, misma fila, pero sin tocar el doc). Ver `AC-1.5`.
- **AC-1.5** — Given el drag-and-drop contiene un archivo **no-imagen** (PDF, Word, Excel según whitelist de `025`), when lo suelto en el editor, then el archivo se sube al panel de adjuntos y aparece una toast breve: "Adjuntado al ticket" con link al panel. El doc no se modifica (los documentos no tienen representación inline en el schema).
- **AC-1.6** — Given el portapapeles no tiene nada que coincida con la whitelist de MIME de `020`/`025` (ej. video `.mp4`), when pego, then no pasa nada en el editor (ni inserción ni toast) — el paste cae a los handlers por defecto de Tiptap y hace lo que haría normalmente (texto plano si lo había, nada si no).

### US-2 · paste también en panel

- **AC-2.1** — Given la subida del paste termina con éxito, when la fila se insertó en `ticket_attachments`, then el panel de Adjuntos **se refresca** (via el mismo mecanismo de `020`/`025`) y muestra el thumbnail de la imagen con el nombre `pasted-image-<timestamp>.png` (o la extensión que corresponda al MIME del clipboard).
- **AC-2.2** — Given la imagen quedó en el panel, when hago click en el thumbnail, then se abre el lightbox de `020` con la imagen a resolución completa — mismo comportamiento que un upload directo.
- **AC-2.3** — Given la imagen quedó inline en la descripción y además en el panel, when hago click en la imagen inline del viewer, then se abre el **mismo lightbox** del panel (la posición de inserción es solo cosmética — el archivo es uno solo). _Decisión diferida al plan: puede ser lightbox común, o abrir en pestaña nueva. Preferencia: lightbox para consistencia._

### US-3 · feedback durante subida

- **AC-3.1** — Given pego una imagen de tamaño medio (1–5 MB), when la subida arranca, then el nodo inline muestra un **spinner superpuesto** sobre la imagen local pre-visualizada (via `URL.createObjectURL`). Mientras el spinner está, el nodo no se puede clickear al lightbox (todavía no hay `attachment_id` resuelto).
- **AC-3.2** — Given mientras la imagen sube el usuario sigue escribiendo texto antes o después del nodo, when el editor se actualiza, then el nodo mantiene su posición relativa y el placeholder sigue mostrándose. El cursor no se mueve.
- **AC-3.3** — Given la subida termina OK, when el server devuelve el `attachment_id`, then el nodo inline **reemplaza** el placeholder con la URL firmada del thumbnail y marca sus `attrs.attachment_id`. Esto se refleja en el `onUpdate` del editor y queda guardado al confirmar el ticket/comentario.
- **AC-3.4** — Given subo una imagen y confirmo el ticket **mientras aún está subiendo**, then el formulario **espera a que todas las subidas en curso terminen** (indicador global tipo `SyncIndicator`) o aborta la publicación con un mensaje claro ("Esperá a que terminen las subidas"). Preferencia: esperar hasta ~15 s con indicador; si pasa ese tiempo cae con el error.

### US-4 · fallo de subida

- **AC-4.1** — Given la subida falla por **tamaño** (> 10 MB tras `025`), when el server responde 413, then el nodo placeholder se **remueve** del doc y aparece una toast: "La imagen pesa más de 10 MB". El resto del doc queda intacto.
- **AC-4.2** — Given la subida falla por **MIME no permitido** (ej. SVG, que está explícitamente fuera), when el server responde 415, then el nodo se remueve y la toast dice "Formato no permitido".
- **AC-4.3** — Given la subida falla por **permisos** (ej. el usuario perdió el rol de contributor entre que abrió el editor y pegó), when el server responde 403, then el nodo se remueve y la toast dice "No tenés permiso para adjuntar archivos a este ticket".
- **AC-4.4** — Given la subida falla por **red** (fetch rechaza, 5xx, timeout), when el error se detecta, then el nodo se remueve y la toast dice "No se pudo subir la imagen. Reintentá o subila desde el panel". **No se reintenta automáticamente** — el usuario decide. La imagen local (si quedaba en `URL.createObjectURL`) se revoca.
- **AC-4.5** — Given hay múltiples subidas simultáneas y una falla, when la que falla se detecta, then **solo ese nodo** se remueve; las otras siguen su curso y las que terminen OK se resuelven normalmente.

### US-5 · viewer server-side

- **AC-5.1** — Given abro el detalle de un ticket cuya descripción tiene nodos `image` con `attachment_id`, when el viewer server-side (`RichTextViewer` de `019`) renderiza el doc, then cada nodo se traduce a un `<img>` con `src` apuntando a una signed URL de **thumbnail** (reusa el handler `GET /api/tickets/:key/attachments/:id/signed-url?variant=thumbnail` de `020`).
- **AC-5.2** — Given tengo permiso de lectura sobre el ticket, when el server resuelve el renderer, then las signed URLs se piden en **batch** (una sola query a Supabase para traer todos los `object_key` + sus thumbs de los adjuntos referenciados en el doc). No N+1.
- **AC-5.3** — Given **no** tengo permiso sobre el ticket (edge case: alguien me pasó el link directo), when la RLS filtra los adjuntos, then los nodos `image` del doc se renderizan como placeholder "Imagen no disponible". El doc en sí sigue mostrando el resto del texto, el usuario entiende que falta algo. Pero realmente este caso no ocurre en flujo normal — para ver el doc tenés que pasar por `can_view_project`, que ya filtra el ticket entero antes de llegar al render.
- **AC-5.4** — Given una signed URL del thumbnail **expiró** (el usuario dejó el detalle abierto > 15 min), when el `<img>` falla a cargar, then el frontend hidrata un reloader (al estilo del lightbox de `020` AC-2.3) que pide la URL de nuevo y reintenta una vez.

### US-6 · borrar nodo del doc preserva adjunto

- **AC-6.1** — Given tengo un ticket con una imagen pegada (nodo `image` en el doc + fila en `ticket_attachments`), when edito la descripción y **borro el nodo** `image` del doc, then al confirmar el ticket la fila de `ticket_attachments` **sigue existiendo** y la imagen sigue apareciendo en el panel.
- **AC-6.2** — Given una imagen quedó solo en el panel (no referenciada por ningún doc), when alguien la mira en el panel, then la ve igual que cualquier upload directo — no hay distinción visual (la distinción de "cómo entró" se cubre en AC-8).
- **AC-6.3** — Given la decisión de preservar el adjunto, when documentamos el comportamiento, then el placeholder empty del editor (si no hay doc previo) tiene un hint: "`Cmd/Ctrl+V` para pegar screenshots". Sutil, aparece solo si el doc está vacío.

### US-7 · borrar adjunto del panel marca los nodos del doc

- **AC-7.1** — Given un adjunto está referenciado por 1+ nodos `image` en algún doc del ticket (descripción o algún comentario), when el autor/PM/admin lo borra desde el panel, then el borrado procede normalmente — **no se bloquea** porque esté referenciado. El `delete` cascadea desde `ticket_attachments` y los objetos del bucket se eliminan.
- **AC-7.2** — Given el adjunto fue borrado, when el viewer server-side renderiza un doc que lo referenciaba, then el nodo `image` sin fila válida se renderiza como un placeholder discreto "Imagen eliminada" (estilo tacho de basura o similar). El doc en sí no se modifica (eso ya se decidió en `020` R-9: el doc es inmutable salvo edición explícita).
- **AC-7.3** — Given un PM borra una imagen pegada por otro, when el usuario original edita después la descripción, then al abrir el editor Tiptap "levanta" el nodo huérfano como placeholder — el usuario puede verlo, decidir borrarlo del doc o dejarlo. **No** se auto-remueve. (Esto es coherente con la filosofía "el doc es del autor, el sistema no reescribe su texto").
- **AC-7.4** — Given el edge case anterior (`AC-7.3`), when el usuario deja el nodo huérfano y confirma la edición, then el doc se guarda con el nodo que apunta a un `attachment_id` que ya no existe. El validador Zod **acepta** esta forma (no valida existencia de FK, solo forma del árbol) — porque validar existencia requiere hit a DB en el validador y es sobreingeniería para un edge case cosmético.

### US-8 · metadato de origen (paste vs upload)

- **AC-8.1** — Given una imagen se subió via paste del editor, when la fila se inserta en `ticket_attachments`, then la columna `source` (nueva, ver plan) vale `'paste'`. Si vino del botón "Subir imagen" del panel, vale `'panel'`.
- **AC-8.2** — Given alguien mira el panel, when ve un adjunto con `source = 'paste'`, then aparece un ícono/badge sutil (ej. `clipboard` chico, color neutro) para distinguirlo de los uploads directos. En hover, tooltip "Pegado desde el portapapeles".
- **AC-8.3** — El badge es informativo, **no bloquea ninguna acción** — borrar, descargar, lightbox funcionan igual para los dos tipos.

---

## 5. Alcance

### Dentro

- **Handler `handlePaste` del editor Tiptap**: detectar `ClipboardEvent.clipboardData.items` con tipo imagen, interceptar el default, subir, insertar nodo. Vive en `src/lib/editor/paste-image.ts` (nuevo), se conecta en `buildRichTextExtensions()` de `src/lib/editor/tiptap-extensions.ts`.
- **Handler `handleDrop` del editor Tiptap**: detectar archivos arrastrados. Si es imagen → mismo flujo que paste (inline + panel). Si es doc permitido (`025`) → solo panel + toast. Si es tipo no permitido → nada.
- **Nodo `image` del `RICH_TEXT_SCHEMA`**: ya está declarado desde `019` pero inert; esta feature lo activa agregándole `attrs: { attachment_id, alt, width, height }`. El validador Zod (`src/lib/editor/validate.ts`) lo acepta solo con `attachment_id` presente y uuid.
- **Renderer server-side (`src/lib/editor/render.ts`)**: traducir nodo `image` → `<img>` con `src` resuelto a signed URL del thumbnail. Batch query para evitar N+1 — una sola llamada que trae todos los `attachment_id` del doc y resuelve sus `object_key` + firma las URLs.
- **Columna `source` en `ticket_attachments`** (text, default `'panel'`, check `in ('panel','paste')`). Migration aditiva simple. Las filas viejas quedan `'panel'` (correcto — vinieron del botón de upload).
- **Hook `useAttachmentUpload()` reusable** (`src/lib/attachments/use-upload.ts`) que encapsula el upload progresivo con callbacks de progreso, éxito, error. Lo consume el paste handler y, en una pasada ligera, también el panel actual (para unificar — hoy el panel tiene su propio código inline en `src/lib/attachments/upload.ts`).
- **Reusar el endpoint `POST /api/tickets/:key/attachments`** de `020`/`025` sin cambios de contrato — se agrega un campo opcional `source` en el multipart. Default `panel` si no se manda (backwards compat).
- **Placeholder "subiendo…" en el nodo inline**: componente `<ImageUploadingPlaceholder>` que renderiza el blob local + spinner. Al terminar la subida, el `onUpdate` del editor reemplaza por el nodo final.
- **Toast de feedback** (reusa el sistema existente — probablemente el `useSyncIndicator()` del CLAUDE.md o un sistema de toasts si existe).
- **Hint "Cmd+V para pegar screenshots"** en el placeholder vacío del editor (empty state).
- **Tests unit**: paste handler emite nodo correcto; validador acepta/rechaza nodos `image` según schema; renderer server-side resuelve batch URL.
- **Tests integración**: paste completo end-to-end — pegar → fila en `ticket_attachments` con `source='paste'` → nodo en doc con `attachment_id` → render del detalle muestra `<img>`.
- **Smoke test**: viewer resuelve signed URLs via embed PostgREST sin N+1.

### Fuera (explícito)

- **Botón "insertar imagen" en la toolbar del editor**. El editor no abre selector de archivos; para eso está el botón del panel. Mantiene la toolbar limpia y evita duplicar el flujo del panel. (Si el equipo lo pide después, es sumar un botón que llame al mismo endpoint — mínimo esfuerzo).
- **Resize de la imagen en el editor** (handles en las esquinas, drag para redimensionar). Fuera del MVP; renderiza a ancho máximo del editor. Si se pide, se suma con la extensión `TiptapImage.extend` + atributos `width`/`height` ya reservados.
- **Reordenar nodos del doc** (eso es Tiptap default, no es "feature nuestra").
- **Caption/alt editable debajo de la imagen**. Fuera del MVP. El `alt` del nodo queda en string vacío por default.
- **Thumbnails separados** (server-side resize). Hoy el thumbnail ya se genera cliente-side por `020` — lo reusamos. Un pipeline de thumbnails separados queda para cuando el volumen lo justifique.
- **Paste en el editor viejo de ProseMirror en otros contextos**. Esta feature toca solo el editor Tiptap compartido de `RICH_TEXT_SCHEMA`, no otros editores que puedan existir (no hay).
- **Garbage collection de adjuntos huérfanos**. Si un usuario pega una imagen y nunca guarda el ticket (cierra el diálogo sin confirmar), la fila ya quedó en `ticket_attachments`. **No** se borra automáticamente — queda en el panel. Mitigación: el formulario de edición de ticket debería hacer un rollback de los uploads pending si se cancela, pero eso agrega complejidad; **preferencia por no implementarlo en MVP** y aceptar que el panel puede juntar algún adjunto "espurio".
- **Cambios al endpoint `GET /api/tickets/:key/attachments/:id/signed-url`**. Lo reusamos tal como está en `020`.
- **Paste de video/audio** (quedó fuera en `020`, sigue fuera).
- **Paste de código con syntax highlighting** (es texto, lo maneja el handler default).
- **Protección anti-DoS vía rate-limiting**. Si alguien pega 100 imágenes de 10 MB en 1 minuto, los límites por archivo + por ticket + los permisos ya cortan. Un rate limit extra es sobre-ingeniería para el MVP.

---

## 6. Dependencias

- **019** — nodo `image` del schema, `RICH_TEXT_SCHEMA`, `RICH_TEXT_MAX_PLAIN_LENGTH`, validador Zod, renderer server.
- **020** — tabla `ticket_attachments`, bucket privado, RLS, endpoints POST/DELETE/signed-url, generación de thumb cliente-side, lightbox.
- **022** — editor compartido entre descripción y comentarios; `buildRichTextExtensions()`; nodo `mention` como precedente de "cómo se agrega un nodo custom al editor".
- **025** — whitelist de MIME ampliada (PDF, Word, Excel). El paste solo acepta imágenes (clipboard no suele traer docs), pero el drag-and-drop sí puede traer docs → van al panel.
- Cero deps externas nuevas. El paste handler y el drop handler son nativos de ProseMirror / Tiptap. El upload reutiliza `fetch` y `FormData` existentes.

---

## 7. Preguntas abiertas

- **Q-1 · Nombre del archivo cuando viene del clipboard.** El clipboard no provee nombre; el browser dice `image.png` o nada. **Recomendación por defecto:** `pasted-<ISO-timestamp>.<ext>`, ej. `pasted-2026-10-13T16-45-12.png`. Es predecible, ordenable y claro. **No bloquea** la implementación.
- **Q-2 · Max concurrentes.** Si el user pega 10 imágenes de golpe, ¿subimos todas en paralelo o secuencial con cap? **Recomendación por defecto:** paralelo con cap de 3 simultáneas, el resto encolado. Browsers tienen limit de conexiones por host; forzar más es contraproducente. **No bloquea.**
- **Q-3 · Timeout de "esperar subidas al confirmar".** `AC-3.4` dice ~15 s. ¿Es razonable? **Recomendación:** 15 s con indicador de progreso; si pasa, el formulario avisa y permite confirmar sin esos adjuntos (los adjuntos siguen subiendo en background y aparecen en el panel cuando terminan). **No bloquea.**
- **Q-4 · ¿El badge visual de "paste" vale el ruido?** AC-8.2. Un ícono chico distintivo en el panel ayuda a limpiar "spam de screenshots" pero suma ruido para quien no lo necesita. **Recomendación:** mostrarlo solo en hover del thumbnail (como el botón de borrar), no por default. **No bloquea.**
- **Q-5 · ¿Qué hace el paste si el ticket es nuevo (todavía no existe)?** En el diálogo de creación de ticket (`<TicketFormDialog>`), no hay un `ticket.key` todavía porque la fila aún no se insertó. **Recomendación:** desactivar el paste de imagen en el editor **mientras el ticket no exista** (igual que `020/spec.md` Q-8 — "solo en edición, no en creación"). Mostrar un hint al intentar: "Guardá el ticket primero para poder adjuntar imágenes". **No bloquea** pero define el UX de creación.
- **Q-6 · ¿Qué pasa con un nodo `image` cuyo `attachment_id` apunta a un adjunto borrado?** Cubierto en AC-7.2/AC-7.3: placeholder "imagen eliminada". **Confirmado por default.**
- **Q-7 · ¿Se mantiene el nodo `image` del schema de `019` con sus attrs originales o se re-define?** El nodo del schema actual de `019` tiene definido `src` como attr. Pero nosotros queremos `attachment_id`. **Recomendación:** el attr principal es `attachment_id` (uuid, obligatorio); los attrs `src`, `width`, `height` quedan secundarios (nullable, se completan en runtime desde el viewer). El validador Zod exige `attachment_id` y rechaza `src` crudo de origen externo (XSS). Esto se decide en el plan.
- **Q-8 · ¿Cuántas Phase deployar iterativo (una por una) vs todo junto?** El flow de deploy iterativo del proyecto (ver memoria) sugiere Phase por Phase. **Recomendación:** sí, Phase 1 (data + migration) + Phase 2 (API extendida + validador + renderer) + Phase 3 (editor paste handler) + Phase 4 (editor drop handler + badge + hint) + Phase 5 (tests + cierre). Cada phase mergeable y deployable sola. **No bloquea** la spec.

---

## 8. Métricas de éxito

- **Adopción** — al menos **70% de los tickets nuevos que contengan imágenes** las agregan por paste en lugar de upload directo (medible por `source = 'paste'` en `ticket_attachments` filtrando por `created_at > deploy_date`). Si menos de 30% usan paste después de 2 semanas, el flujo no está siendo descubierto y hace falta on-boarding o un botón explícito.
- **Latencia percibida** — el nodo placeholder debe aparecer en **< 100 ms** del paste (es decir, antes de que el usuario vea alguna respuesta de red). La subida completa a 2 MB debe terminar en **< 3 s** en condición normal.
- **Error rate** — menos de **1% de pastes terminan en toast de error** en la primera semana (excluye errores de usuario como pegar un SVG). Un error rate más alto sugiere problema de infra, no de UX.
- **Cero regresiones en el panel actual** — los uploads directos del botón "Subir imagen" siguen funcionando igual. El hook unificado `useAttachmentUpload()` no debe romper lo que `020`/`025` dejaron andando.
- **Cero regresiones en comentarios de `022`** — el paste anda tanto en descripción como en comentarios, sin romper el flujo de mention.

---

## 9. Riesgos conocidos

- **R-1 · El paste de Chrome en Mac genera un `image.png` sin nombre útil.** Mitigación en Q-1: usar `pasted-<timestamp>.png`.
- **R-2 · El `URL.createObjectURL` del placeholder puede filtrar memoria** si el usuario pega 50 imágenes y navega sin que se revoquen. **Mitigación:** revocar con `URL.revokeObjectURL` en el `useEffect` cleanup del placeholder y cuando la subida termine (éxito o error).
- **R-3 · El validador Zod no exige que `attachment_id` apunte a una fila real.** Esto es a propósito (ver AC-7.4) para no hacer DB queries en el validador, pero significa que un atacante podría inyectar un `attachment_id` apuntando a un adjunto de otro ticket. **Mitigación:** el viewer server-side, al resolver la signed URL, chequea que el `attachment.ticket_id` coincida con el ticket que se está renderizando (filtro en el embed de PostgREST). Si no coincide, se renderiza "imagen no disponible". Esto cierra el vector sin un trigger de validación cross-table.
- **R-4 · El renderer server-side agrega una query extra al detalle del ticket** (una por doc). Para tickets con descripción + 10 comentarios, son 11 queries de thumbnails. **Mitigación:** AC-5.2 — batch en una sola query. El renderer **recibe** el conjunto de adjuntos del ticket (que ya se trae para el panel), no vuelve a consultar. Se pasa como prop al `RichTextViewer`.
- **R-5 · El paste en comentarios dispara el flujo cuando el comentario todavía no se publicó.** El `attachment_id` existe (fila ya está) pero el `ticket_comment_id` todavía no (el comentario se escribe cuando se envía). Si el usuario cancela, queda un adjunto en el panel sin comentario. **Mitigación:** aceptado, mismo issue que ticket nuevo pero más chico (comentarios tienen menos "intención" de borrar). El adjunto es del **ticket**, no del comentario — eso ya lo tiene `020`.
- **R-6 · Dos usuarios editando el mismo doc pegando imágenes simultáneamente.** El doc es jsonb, no hay merge automático; el `expectedUpdatedAt` del PATCH detecta la carrera. **Mitigación:** si uno pierde la carrera, su nodo pegado queda huérfano en el panel (la imagen está, el doc no se actualizó). Toast "Alguien más editó el ticket, refrescá y volvé a intentar". Acceptable, es el mismo comportamiento de edit race que ya existe.
- **R-7 · El drop handler puede chocar con el drag de nodos internos de Tiptap** (reordenar bloques). **Mitigación:** el handler solo intercepta cuando `event.dataTransfer.files.length > 0` — si son nodos internos, no hay `files`, el handler default de Tiptap sigue.
- **R-8 · XSS vía `attachment_id` manipulado**. Cubierto en R-3.
- **R-9 · El doc guardado con nodos `image` apuntando a adjuntos de otro proyecto** (atacante cross-tenant). Cubierto en R-3 con el filtro en el embed.

---

## 10. Notas

- Esta feature **no requiere ADR** porque las decisiones son locales (son extensiones al editor y a la tabla de adjuntos, dentro de la lógica de `019`/`020`). Si en el plan aparece algo cross-feature (como una convención de "nodo custom en el schema que referencia FK a tabla externa"), se evalúa.
- El modelo híbrido elegido (`inline + panel`) es exactamente el que `020/spec.md` R-9 anticipó. Esta feature valida la arquitectura con cero refactor retroactivo — señal de que la spec de `020` fue bien escrita.
- **Compatibilidad hacia atrás:** docs viejos (sin nodos `image`) siguen renderizándose idéntico. La columna `source` nace con default `'panel'` para las filas existentes de `020`/`025`, lo cual es correcto históricamente.
- **Deploy iterativo** (Q-8): la feature se divide naturalmente en 5 phases, cada una mergeable y verificable en producción sin romper lo anterior. Esto encaja con el iterative-deploy-flow del proyecto.
