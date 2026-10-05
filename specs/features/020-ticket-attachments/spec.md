# Spec — Adjuntos en tickets (imágenes)

- **ID:** 020-ticket-attachments
- **Estado:** draft
- **Referencias:** `015-project-membership-and-tickets` (tabla `tickets`, RLS, project members). `019-ticket-rich-editor` dejó el nodo `image` declarado en `RICH_TEXT_SCHEMA` para uso futuro; **esta feature no lo enciende**, solo suma un panel de adjuntos aparte del cuerpo de la descripción.

---

## 1. Objetivo

Permitir subir **imágenes** como adjuntos de un ticket. Cada adjunto se lista en un panel propio en la vista de detalle (fuera del rich text de `019`), con preview inline, nombre, tamaño, quién lo subió y cuándo. Los archivos viven en storage privado, se acceden vía URLs firmadas con vencimiento, y respetan la misma RLS de tickets — quien no puede leer el ticket no puede ver ni descargar sus adjuntos.

**Alcance del MVP: solo imágenes** (`image/png`, `image/jpeg`, `image/webp`, `image/gif`). Otros tipos (PDF, docx, zip, etc.) quedan explícitamente fuera y se suman en una fase posterior con la misma infra. Se elige este alcance chico porque:

1. Los tres bugs más frecuentes que reportan los devs vienen con screenshot — un input de imagen resuelve el 80% de los casos hoy.
2. Renderizar imagen en el detalle es trivial (thumbnail + lightbox), no hay que pensar iconos por tipo, viewer de PDF, ni empaquetar archivos zip.
3. La whitelist de MIME types corta a nivel API y también en el input `accept=` del `<input type="file">` — sumar tipos después es agregar entries a esa whitelist sin migration ni cambio de arquitectura.

**Fase 2 (feature aparte, no en este ciclo):** *paste de imagen al editor rich text.* Un `Cmd/Ctrl+V` con una screenshot en el portapapeles arriba del cursor sube la imagen como adjunto de este ticket y **la inserta en el doc de descripción como nodo `image`** referenciando el adjunto. Requiere: (a) encender el nodo `image` en la toolbar y el paste handler del editor de `019`, (b) que el upload sea desde el editor mismo y no desde el panel, (c) resolver el ciclo de vida — qué pasa con un adjunto insertado en la descripción cuando el usuario borra la imagen del texto (¿se elimina el adjunto? ¿queda huérfano?). Todo eso se define en su propia spec cuando toque; **esta feature deja la fundación en su lugar (tabla, bucket, RLS, endpoints de upload/delete) para que solo haya que agregar el handler del editor**.

---

## 2. Contexto

Hoy los tickets no tienen forma de adjuntar contenido binario. El workaround que usa el equipo es pegar el link de una imagen subida a Slack o Google Drive dentro de la descripción — funciona pero rompe cuando:

- El link es de un Slack privado y otro dev no está en el canal.
- El archivo se elimina del origen y el link queda muerto.
- El PM quiere ver el screenshot en el ticket sin abrir cuatro pestañas.

`019` dejó anotado explícitamente que el nodo `image` está en el schema pero deshabilitado, y que `020` "solo tiene que encender el upload". Cuando llegó el momento de hacerlo, aparecieron dos consideraciones que reformulan esa promesa:

1. **Adjuntos como panel separado es más flexible que solo `image` en la descripción.** Un doc que solo se sube "porque tiene contexto" no tiene por qué vivir dentro del texto — un panel de "Adjuntos" al pie del ticket (mismo patrón que Jira/Linear/GitHub) es más limpio para archivos que no son parte de la narrativa. Deja el paste-al-editor como un shortcut sobre esa misma infra, no como el único camino.
2. **Empezar con imágenes acota el diseño.** Si desde el principio la feature soporta PDF, docx, csv, etc., hay que decidir preview vs. descarga, viewer inline, iconos por tipo, thumbnails para imágenes vs. cards para el resto. Solo imágenes cierra todas esas preguntas: hay preview inline, no hay descarga (link directo o download vía signed URL), no hay iconos.

**Por qué panel separado + paste al editor como fase 2 y no todo junto.** El panel es autosuficiente y ya cubre el caso "quiero adjuntar un screenshot al ticket". El paste requiere reconciliar el ciclo de vida entre "el adjunto es propiedad del ticket" y "el adjunto está referenciado en el doc" — y eso agrega complejidad que no vale postergar el primer valor. Sale primero el panel; cuando esté verificado, la fase 2 conecta el editor con el mismo bucket sin volver a tocar storage ni RLS.

---

## 3. User stories

- **US-1 · Adjuntar imagen al ticket** — Como cualquier miembro del proyecto con permiso de edición del ticket, quiero subir una o varias imágenes al detalle para dejar screenshots junto a la descripción, sin tener que pegarlas en Slack ni en Drive.
- **US-2 · Ver preview inline** — Como cualquier miembro con permiso de lectura del ticket, quiero ver los adjuntos como thumbnails en el detalle y poder abrir cada uno a tamaño completo, para no tener que descargarlo antes de decidir si me sirve.
- **US-3 · Descargar el original** — Como usuario que ve un adjunto, quiero poder descargarlo o abrirlo en una pestaña nueva a resolución completa, con el nombre original del archivo.
- **US-4 · Borrar mis propios adjuntos** — Como quien subió un adjunto, quiero poder borrarlo si me equivoqué (subí el archivo mal, un dato sensible, o duplicado), sin depender del PM ni del admin.
- **US-5 · El PM primario y el admin pueden moderar** — Como PM primario del proyecto o admin, quiero poder borrar adjuntos de otros miembros si contienen datos que no van, sin escalar más.
- **US-6 · Aviso de subida** — Como asignado del ticket (o creador, si es distinto), quiero enterarme cuando alguien sube un adjunto al ticket, para revisarlo si aporta contexto o pedir aclaraciones. Mismo canal que hoy (bandeja + email si está configurado).
- **US-7 · Los adjuntos siguen la RLS del ticket** — Como dueño del sistema, quiero que quien no puede leer el ticket **no pueda** obtener el archivo, ni siquiera adivinando la URL directa del storage — la RLS del bucket espeja la del ticket.

---

## 4. Acceptance criteria

### US-1 · adjuntar imagen

- **AC-1.1** — Given estoy viendo el detalle de un ticket, when tengo permiso para editar el ticket (mismo `canEditTicket` de `015`: creador, asignado, lead, PM primario, admin), then veo un panel **"Adjuntos"** con un botón "Subir imagen" y (si ya hay) una grilla de thumbnails.
- **AC-1.2** — Given clickeo "Subir imagen", when se abre el selector nativo de archivos, then acepta solo tipos `image/png`, `image/jpeg`, `image/webp`, `image/gif` (por atributo `accept=` del input). Puedo seleccionar **más de un archivo** en la misma acción.
- **AC-1.3** — Given elijo uno o varios archivos, when confirmo la selección, then cada archivo se sube en paralelo y aparece en el panel con un placeholder de "Subiendo…" hasta que termina; el fallo de uno **no aborta** los otros.
- **AC-1.4** — Given intento subir un archivo mayor a **5 MB**, when el cliente lo detecta antes de mandarlo, then muestra un error inline "El archivo pesa más de 5 MB" y no dispara la request. Si por algún motivo llega al server (cliente viejo, API directa), el handler responde 413 con el mismo mensaje.
- **AC-1.5** — Given ya subí archivos que en total pesan cerca del **límite por ticket de 50 MB**, when intento subir otro archivo que haría pasar el total, then el cliente lo detecta y muestra "El ticket ya tiene 50 MB de adjuntos, no se puede subir más". El server rechaza con 413 si llega igual (protección dura).
- **AC-1.6** — Given un archivo con MIME type distinto a las cuatro imágenes permitidas, when lo mando por API (sin pasar por el `accept=`), then el server responde 415 "Tipo de archivo no permitido".
- **AC-1.7** — Given la subida es exitosa, when el archivo queda en storage y la fila en `ticket_attachments`, then el panel refleja el thumbnail sin recargar la página; el nombre original, tamaño legible ("124 KB"), quién subió y "hace N min/h/d" se ven al lado.

### US-2 · ver preview

- **AC-2.1** — Given tengo permiso de lectura sobre el ticket, when se renderiza el detalle, then el panel "Adjuntos" carga los thumbnails de las imágenes vía URLs firmadas con expiración (ver §5 storage). Sin permiso no se piden URLs, no se muestran thumbnails.
- **AC-2.2** — Given clickeo un thumbnail, when se abre el lightbox, then veo la imagen a resolución completa, puedo navegar entre adjuntos con flechas, y cerrar con `Esc` o click fuera. En móvil, pinch-to-zoom del browser.
- **AC-2.3** — Given el lightbox está abierto, when la imagen tarda en cargar, then hay un spinner discreto. Si la URL firmada expiró (el usuario la dejó abierta 15+ minutos), el server responde 403 y el frontend recarga la URL firmada silenciosamente y reintenta una vez.

### US-3 · descargar el original

- **AC-3.1** — Given veo un adjunto (thumbnail o lightbox), when clickeo el nombre del archivo o un botón "Descargar", then la descarga viaja con el **nombre original** (`Content-Disposition: attachment; filename="..."`) y **resolución completa**.
- **AC-3.2** — Given la URL firmada de descarga se copió y otro usuario la abre, when ese otro usuario no tiene permiso sobre el ticket, then el link **no funciona** — la URL firmada es válida solo si el que la pidió al server pasó la RLS (o sea, siempre pasa por un handler que autoriza).

### US-4 · borrar mis adjuntos

- **AC-4.1** — Given veo un adjunto que yo mismo subí, when hago hover sobre el thumbnail (o abro un menú de contexto), then aparece un botón "Borrar" con confirmación.
- **AC-4.2** — Given confirmo el borrado, when el server valida que soy el autor del adjunto, then borra la fila de `ticket_attachments` y **también el objeto del bucket** en la misma transacción operativa (el DELETE de la fila dispara la eliminación en storage; si el storage falla, la fila queda — se reintenta o queda como huérfano registrado en audit).
- **AC-4.3** — Given no soy el autor del adjunto ni PM primario ni admin, when intento borrarlo, then no veo el botón, y si por API mando el DELETE, el server responde 403.

### US-5 · moderación PM/admin

- **AC-5.1** — Given soy PM primario del proyecto (`projects.pm_id = auth.uid()`) o admin, when veo cualquier adjunto del ticket, then también veo el botón "Borrar" y puedo confirmarlo — la RLS del server acepta la operación.
- **AC-5.2** — Given un PM/admin borra un adjunto ajeno, when se completa el borrado, then queda un registro en `audit_log` con `actor_id`, `entity="ticket_attachment"`, `action="delete"`, y snapshot del metadata (nombre, tamaño, autor original, timestamp). Esto es una excepción intencional: `audit_log` normalmente guarda el diff, pero para deletes conservamos el snapshot completo (patrón de `016` para `time_entries`).

### US-6 · aviso de subida

- **AC-6.1** — Given alguien sube un adjunto a un ticket, when la fila se inserta en `ticket_attachments`, then un trigger encola una notificación `ticket_attachment_added` para (a) el asignado del ticket (si es distinto del autor del adjunto) y (b) el creador del ticket (si es distinto del autor del adjunto y del asignado). Mismo patrón que `010`: fila en `notifications`, envío async por Resend si `RESEND_API_KEY` está seteada.
- **AC-6.2** — El copy del aviso menciona el nombre del archivo y quién lo subió: "Nicolás Galano adjuntó screenshot-error.png a HILCOV-1". Link a `/tickets/HILCOV-1#adjuntos`.
- **AC-6.3** — Nadie recibe aviso de su propia acción — misma regla que `notify_user()` de `010`.

### US-7 · RLS espejo del ticket

- **AC-7.1** — La tabla `ticket_attachments` tiene RLS que replica exactamente la RLS de `tickets` (via `can_view_project(project_id, auth.uid())` para read y `can_edit_ticket(...)` para write). Un test explícito prueba: viewer no ve el adjunto en el listado, ni en el link firmado; contributor ajeno tampoco.
- **AC-7.2** — El bucket de storage donde viven los archivos es **privado**. La única forma de acceder a un objeto es una URL firmada emitida por un handler que primero pasa por el guard de permiso sobre el ticket. No hay URL pública predecible. Un archivo cuyo `object_key` sea adivinado (formato uuid/nombre) igual **rebota** al pedirlo sin firma válida.
- **AC-7.3** — Un `DELETE /projects/:id` (si algún día se agrega) cascadea a los adjuntos: el trigger de storage borra los objetos correspondientes al bucket. Hoy los proyectos no se borran, se desactivan — el punto es que la relación DB → storage no queda huérfana si el flujo cambia.

---

## 5. Alcance

**Dentro:**
- Tabla `ticket_attachments`: `id`, `ticket_id` (FK), `project_id` (denormalizado para RLS eficiente, patrón de `015`), `object_key` (path en el bucket), `original_filename`, `mime_type`, `size_bytes`, `uploaded_by` (FK a `profiles`), `created_at`.
- Bucket privado en el storage elegido (ver Q-1). Estructura de path: `tickets/<ticket_id>/<uuid>-<slug-de-nombre>` para que el listado de objetos en el bucket sea auditable y no dependa del nombre original (evita colisiones + preserva evidencia).
- RLS sobre `ticket_attachments` (read = `can_view_project`, insert = `can_edit_ticket`, delete = autor + PM primario + admin).
- Trigger de notificación `ticket_attachment_added` (patrón `010`, tabla `notifications` existente).
- Trigger de audit_log para inserts y deletes (patrón `015`, snapshot completo en delete).
- API:
  - `POST /api/tickets/:key/attachments` — recibe multipart, valida MIME/tamaño/límite total, sube al bucket, inserta la fila.
  - `DELETE /api/tickets/:key/attachments/:id` — chequea permisos, borra fila + objeto.
  - `GET /api/tickets/:key/attachments/:id/signed-url?variant=thumbnail|full` — devuelve URL firmada con vencimiento corto (15 min).
- UI:
  - `<TicketAttachmentsPanel>` client component: input de archivo múltiple, grilla de thumbnails, lightbox propio (o dep chica).
  - Integración en `<TicketDetail>` debajo de la descripción y encima del bloque de horas cargadas.
- Zod schemas para los tres endpoints.
- Whitelist estricta de MIME types en un solo archivo (`src/lib/attachments/types.ts`) compartida por API y UI.
- Límite duro por archivo (5 MB) y por ticket (50 MB) — chequeados client-side (UX) y server-side (garantía).
- Test de integración: RLS espeja la del ticket, delete cascadea la fila, signed URL rebota sin permiso.
- Test unit: validador de MIME y tamaño, resolución del path.

**Fuera:**
- **Paste al editor.** Fase 2 aparte (ver §9). El nodo `image` de `RICH_TEXT_SCHEMA` sigue sin toolbar y sin paste handler en esta feature.
- **Tipos distintos a imagen.** PDF, docx, csv, zip — quedan como whitelist a extender cuando aparezca el caso. La arquitectura los soporta sin cambios; solo agregar entries.
- **Comentarios en tickets** — feature paralela no relacionada, cuando corresponda.
- **Video/audio.** Archivos grandes con streaming son otro problema (rangos, códecs, thumbnails).
- **Compresión/redimensionamiento server-side.** Si el usuario sube un PNG de 4 MB, se guarda tal cual. Generar thumbnails más chicos vive como optimización futura (ver R-4).
- **Búsqueda de tickets por contenido de adjuntos** (OCR, texto en PDF).
- **Reordenar adjuntos manualmente.** El orden es por `created_at` ascendente.
- **Renombrar adjuntos.** El nombre original queda tal cual.
- **Bulk delete.** Uno a uno.
- **Attachments en `sprints`, `time_entries`, `bookings`.** Si en algún momento se necesita, se reusa la misma infra parametrizando por entidad, pero no se hace ahora.

---

## 6. Preguntas abiertas

- **Q-1 · Storage: Supabase Storage o S3.** **Abierta.** Decisión en el plan.
  - **A favor de Supabase Storage:** cero deps nuevas, credenciales ya existen, la RLS del bucket se define en la misma migration y comparte helpers (`can_view_project`) — un único mundo mental. Signed URLs nativas. Precio incluido en el plan de Supabase (hasta 1 GB free tier, luego escala con storage cost). Suficiente para el volumen esperado (< 100 tickets/mes × ~2 MB/adjunto promedio = ~200 MB/año).
  - **A favor de S3:** más control sobre CDN (Cloudfront), regiones, precios a escala grande. Ecosistema maduro para procesamiento (Lambda@Edge para thumbnails, versionado, lifecycle policies).
  - **Preferencia inicial: Supabase Storage.** La ventaja de S3 no se cobra en el volumen del proyecto. Volver atrás es factible: la abstracción sobre "qué storage" queda en un helper (`src/lib/attachments/storage.ts`) — cambiar de provider es una migration del contenido y reescribir ese helper.
- **Q-2 · Thumbnails server-side o CSS?** **Abierta.** El browser puede rescalar la imagen full con CSS (`max-width`) al tamaño del thumbnail — simple, sin server processing. Pero descarga la imagen entera aunque se muestre chica: 20 adjuntos de 3 MB = 60 MB de tráfico por render. **Preferencia inicial: CSS-only en el MVP, con un cap del volumen visible** (los primeros 6 adjuntos se muestran con thumbnail eager, el resto pide click para expandir). Si el problema aparece, se suma pipeline de thumbnails con Sharp o un Edge Function.
- **Q-3 · ¿El bucket es único para toda la app o uno por proyecto?** **Abierta.** Preferencia inicial: **único bucket** con paths jerárquicos (`tickets/<id>/`). Simplifica la administración (una policy de RLS, un bucket para monitorear). Un bucket por proyecto duplica configuración por 0 ganancia real.
- **Q-4 · Nombre original con caracteres especiales.** **Abierta.** Preferencia inicial: **guardar el nombre tal cual** en `original_filename` (columna text, sin normalizar), pero **normalizar el `object_key`** (uuid + slug ASCII del nombre) para evitar problemas con signos raros en URLs o filesystems. El `Content-Disposition` del download usa el nombre original tal cual.
- **Q-5 · Adjuntos huérfanos por fallos parciales.** **Abierta.** Si el upload al bucket sale bien pero el `insert` a `ticket_attachments` falla (raro pero posible), el objeto queda huérfano en storage. **Preferencia inicial:** el handler sube primero al bucket con un path temporal, después inserta la fila; si el insert falla, borra el objeto. Cleanup diario opcional después (job cron que busca objetos en el bucket sin fila en la tabla, con delay de gracia de 1 h).
- **Q-6 · Retención al desactivar un proyecto.** **Abierta.** Preferencia inicial: **no se toca**. Los adjuntos siguen existiendo mientras el proyecto exista (incluso desactivado). Solo se borran si alguien borra el ticket (que hoy no es posible — `status = 'cancelled'`) o si se implementa un endpoint de purge (futuro).
- **Q-7 · Formato SVG.** **Abierta.** Preferencia inicial: **excluido del MVP.** SVG puede contener JavaScript (`<script>` embebido, event handlers) — es un vector de XSS. Aceptar SVG obliga a sanearlo (con `DOMPurify` o similar) antes de servir. Fuera de scope; se puede sumar cuando alguien lo pida.
- **Q-8 · ¿Se muestra el panel en tickets nuevos (creación) o solo en edición?** **Abierta.** Preferencia inicial: **solo en edición** — al crear un ticket, el diálogo cierra, redirige al detalle, y ahí se pueden subir adjuntos. Meter el uploader dentro del diálogo de creación complica el flujo (¿qué pasa si se cancela después de subir?) y no aporta valor claro.

---

## 7. Riesgos

- **R-1 · Un adjunto con MIME falseado puede ser un vector.** Un archivo `.png` que en realidad es HTML con `<script>` se podría servir como HTML si el server responde con content-type incorrecto. **Mitigación:** el handler **fuerza** el `Content-Type` de respuesta según lo que dice el `mime_type` guardado (que a su vez se valida al subir), no según lo que diga el bucket. Adicionalmente, el header `X-Content-Type-Options: nosniff` va en todas las respuestas de descarga.
- **R-2 · Colisión de nombres o traversal.** Un archivo llamado `../../../etc/passwd.png` podría escapar del path esperado. **Mitigación:** el `object_key` **no** usa el nombre original — usa `tickets/<uuid-ticket>/<uuid-attachment>-<slug-normalizado>`. El slug se genera con una función que solo deja `[a-z0-9-_]`. El nombre original se guarda solo en la fila `original_filename` para mostrar y para el download header.
- **R-3 · Signed URLs filtradas.** Un usuario copia una URL firmada válida y la manda a alguien que no tiene permiso. **Mitigación:** vencimiento corto (15 minutos) y URLs de un solo uso si el provider lo soporta. Con Supabase Storage, las signed URLs son de uso ilimitado hasta la expiración — mitigado con expiración corta. Si el caso se vuelve importante, se agrega una capa de proxy (`GET /api/attachments/:id/proxy`) que redirige y valida por request.
- **R-4 · Volumen de tráfico por thumbnails full-size.** Q-2 abierta. Un ticket con 10 screenshots de 3 MB muestra 30 MB al abrir el detalle, aunque el usuario nunca clickee. **Mitigación inicial:** eager load de los primeros 6 solamente, el resto necesita expandir. Pipeline de thumbnails (Sharp/Edge Function) es la solución si aparece el problema.
- **R-5 · Fallo parcial deja objetos huérfanos.** Q-5 abierta. Mitigación descrita en la respuesta.
- **R-6 · Storage cost silent creep.** Adjuntos se acumulan; nadie los mira; el bill de Supabase Storage crece. **Mitigación:** al pie del detalle del ticket se muestra el uso total del ticket ("de 50 MB usados: 12 MB"). Al final del ciclo, mirar el bill y decidir si sumar retention policies o cleanup de tickets muy viejos.
- **R-7 · Concurrencia en el límite total de 50 MB.** Dos usuarios suben adjuntos al mismo ticket al mismo tiempo; el chequeo de "cabe en 50 MB" pasa para los dos y el total termina en 60 MB. **Mitigación:** el chequeo del server se hace **dentro** de la misma transacción que el insert, con un `SELECT ... FOR UPDATE` sobre el ticket que serializa los uploads concurrentes. La violación del límite se resuelve rechazando el segundo con 413.
- **R-8 · Contributor sube spam.** Un contributor con permiso de edición sube 10 imágenes de 5 MB por error o intencional. **Mitigación:** el límite duro de 50 MB por ticket lo cierra en ese ticket. Un límite por usuario por día (rate limit) es una feature futura si aparece abuso.
- **R-9 · La fase 2 (paste en el editor) tiene su propio riesgo de ciclo de vida.** Cuando llegue, hay que decidir qué pasa con un adjunto que fue insertado como nodo `image` en el doc y después el usuario borra ese nodo: ¿se elimina el archivo? ¿queda "para descarga" en el panel? La spec de esa fase resuelve, pero **hay que preverlo en el diseño de esta feature**: la tabla `ticket_attachments` **no** referencia al nodo del doc — la relación es solo "este adjunto pertenece a este ticket". Los nodos `image` del doc futuro van a referenciar el `attachment_id` por FK; borrar el nodo del doc no borra el adjunto automáticamente, y eso es lo correcto (el usuario puede querer conservarlo en el panel).

---

## 8. Dependencias

- **015** — tabla `tickets`, RLS por `can_view_project`, `can_edit_ticket`, `project_id` denormalizado. Se replica el mismo patrón acá.
- **010** — tabla `notifications`, patrón trigger + dispatch async. Se suma un tipo de notificación (`ticket_attachment_added`) y el copy correspondiente en `src/lib/notifications/events.ts`.
- **019** — el nodo `image` de `RICH_TEXT_SCHEMA` sigue reservado; **esta feature no lo enciende**. La relación explícita es "020 sienta las bases, la fase 2 aprovecha".
- **No depende** de 016 (time tracking), 017 (workspaces), 018 (sprints), 013 (deuda). Convive.

---

## 9. Compatibilidad con features futuras

- **Fase 2 · Paste de imágenes en el editor rich text.** Spec dedicada cuando toque. Suma un handler `handlePaste` al editor de `019` que detecta imágenes en el portapapeles, las sube usando el mismo endpoint `POST /api/tickets/:key/attachments` de esta feature, y **al recibir el `attachment_id`** inserta un nodo `image` en el doc con ese id. El renderer server-side de `019` va a resolver el `image.src` pidiendo la URL firmada al abrir el detalle. Cambios mínimos en esta feature para dejar el camino abierto:
  - La tabla `ticket_attachments` **no** guarda referencia al nodo del doc — cada adjunto es una entidad independiente del ticket, no de la descripción.
  - El endpoint de upload devuelve el `id` del adjunto en la respuesta 201 — la fase 2 lo va a usar para insertar el nodo.
  - El bucket y el path structure ya soportan el caso (paths por ticket, no por adjunto individual).
- **Ampliación a más tipos** (PDF, docx, zip, csv, etc.). La whitelist de MIME types vive en un solo archivo (`src/lib/attachments/types.ts`). Sumar tipos requiere:
  - Agregar la entry al whitelist.
  - Decidir cómo se renderiza (icono por tipo + click para descargar es lo estándar).
  - Cero cambios en storage, RLS, endpoints o notificaciones.
- **Comentarios en tickets.** Feature paralela; los adjuntos de un comentario se agregarían como una tabla propia (`ticket_comment_attachments`) o extendiendo `ticket_attachments` con un `comment_id nullable`. Se decide cuando aparezca.
- **Attachments en otras entidades** (sprints, reservas). Se pueden generalizar reusando la misma tabla parametrizada por entidad, o duplicando el patrón. Nada de esto está previsto; **no se hace ahora** porque abstraer sin caso concreto es sobreingeniería.
