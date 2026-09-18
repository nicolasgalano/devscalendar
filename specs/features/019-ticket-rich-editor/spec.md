# Spec — Editor rich text para descripciones de tickets

- **ID:** 019-ticket-rich-editor
- **Estado:** draft
- **Referencias:** `015-project-membership-and-tickets` (tickets, columna `description` markdown, RLS, trigger de contributor-scope). Prepara `020-ticket-attachments` (el nodo `image` del schema queda declarado acá y lo enciende esa feature).

---

## 1. Objetivo

Reemplazar el `<textarea>` + markdown crudo de la descripción de un ticket por un editor **rich text WYSIWYG** basado en Tiptap/ProseMirror. Lo que el usuario ve mientras escribe es lo que se guarda: negritas, listas, checklists, code blocks, links y blockquotes se aplican con la toolbar o atajos, sin exigir saber sintaxis markdown. El contenido se persiste como **JSON** de ProseMirror en una nueva columna `tickets.description_doc`, y el viewer se re-renderiza server-side desde ese JSON para mantener la vista actual de tickets sin `"use client"`.

La feature deja también **el nodo `image` declarado en el schema pero deshabilitado en la toolbar**, para que `020-ticket-attachments` solo tenga que encender el upload sin volver a tocar el editor.

---

## 2. Contexto

El editor actual (`src/lib/markdown/editor.tsx`) es un `<textarea>` con tres botones (bold, italic, link) y un toggle "Escribir / Vista previa". Se justificó en `015` como MVP con el argumento "los devs escriben markdown a mano y los no-devs usan los tres botones". En la práctica, con el equipo real, dos cosas rompieron ese supuesto:

1. **La mitad de los PMs no escribe markdown.** Un `#`, un `*`, o el bloque de código con triple backtick no forman parte del vocabulario. La consecuencia es que las descripciones o son de una línea sin formato, o son formato inconsistente ("**palabra**" a veces, otras veces con asteriscos visibles porque quedó mal escrito).
2. **Los devs que sí saben markdown pegan contenido de otro lado** (Slack, docs internos, mails) y llega con sintaxis rota — los guiones de Slack no son bullets, las citas de Gmail traen `>` que se interpreta como blockquote sin querer, los links pegados quedan como texto plano.

El editor WYSIWYG resuelve las dos: el PM tiene toolbar visible con las mismas acciones que un procesador de texto, y el paste sanitizado convierte lo que llega a los nodos permitidos sin arrastrar estilos ni fuentes.

**Por qué JSON de ProseMirror y no HTML.** El HTML sanitizado sigue siendo texto: cada lectura tiene que pasar por `rehype-sanitize` o equivalente, y una whitelist mal escrita en el sanitizer expone XSS. El JSON de ProseMirror es una **estructura tipada** de nodos y marks del schema — lo que no está en el schema no se puede representar. Sanitizamos una vez, al guardar, validando que el doc reconstruya contra el schema; a partir de ahí, cada lectura es render puro sin riesgo.

**Por qué es su propia feature y no parte de `020`.** El editor y el upload son dos superficies distintas de complejidad: el editor implica migración de datos existentes, nuevo schema, cambio de contrato del API y validación server-side de un formato nuevo. El upload implica bucket de storage, RLS sobre `storage.objects`, signed URLs y cleanup. Mezclar los dos en una feature bloquea el review y complica el rollback. Sale primero el editor; cuando esté en producción y verificado, `020` enciende el nodo `image`.

---

## 3. User stories

- **US-1 · Editar sin saber markdown** — Como PM del proyecto (no técnico), quiero un editor visual donde vea el formato mientras escribo, para no tener que aprender sintaxis markdown ni recordar qué símbolo hace qué.
- **US-2 · Atajos de teclado** — Como dev acostumbrado a atajos, quiero seguir formateando con `Cmd/Ctrl+B` (negrita), `Cmd/Ctrl+I` (cursiva), `Cmd/Ctrl+K` (link) y `Cmd/Ctrl+Z` (undo), para no perder velocidad respecto al editor viejo.
- **US-3 · Bloques de contenido** — Como cualquier miembro con permiso de edición, quiero poder insertar heading (nivel 1–3), listas con y sin viñetas, checklists interactivos, code inline, code block con lenguaje, blockquote, link con URL, y línea horizontal, para expresar la descripción con la estructura que necesite.
- **US-4 · Paste limpio** — Como usuario, quiero pegar texto desde Google Docs, Slack, Notion, mail o el navegador y que llegue con formato pero sin colores, fuentes ni estilos inline, para que la descripción se vea consistente con el resto de los tickets.
- **US-5 · Ver la descripción igual que el editor** — Como cualquier miembro con lectura, quiero que la descripción del ticket se vea en el detalle con el mismo formato que el editor mostró al autor, sin diferencias tipográficas ni de espaciado.
- **US-6 · Descripciones existentes** — Como dueño del sistema, quiero que los tickets creados antes de esta feature sigan visibles y editables sin degradación después del deploy — la migración del markdown a JSON tiene que ser transparente.
- **US-7 · Preservar la restricción del contributor** — Como PM o admin, quiero que la regla "un contributor no edita la descripción" siga vigente (heredada de `015`), sin que la migración a la nueva columna abra un agujero.

---

## 4. Acceptance criteria

### US-1 · editar sin saber markdown

- **AC-1.1** — Given abro el diálogo de edición o creación de un ticket, when hago foco en el editor de descripción, then veo una toolbar visible con botones para: negrita, cursiva, código inline, link, heading (H1/H2/H3), lista con viñetas, lista numerada, checklist, blockquote, code block, línea horizontal. Cada botón tiene tooltip con su nombre y (si aplica) su atajo.
- **AC-1.2** — Given selecciono texto y clickeo un botón de la toolbar, when se aplica el formato, then el texto se ve inmediatamente con el estilo final (WYSIWYG) — no hay modo "escribir" y "vista previa" separados. El toggle actual desaparece.
- **AC-1.3** — Given el editor está vacío, when el placeholder es visible, then dice "Descripción del ticket…" en el color y densidad del tema (mismo copy que hoy).
- **AC-1.4** — El editor mantiene el límite de longitud actual, medido sobre el **texto plano extraído del doc**: máximo 10.000 caracteres. Al llegar al límite, la próxima tecla no ingresa nada y el contador cambia de color (misma UX del contador actual).

### US-2 · atajos de teclado

- **AC-2.1** — Given foco en el editor, when presiono `Cmd/Ctrl+B`, then el texto seleccionado se pone en negrita (o se abre negrita en el cursor si no hay selección). Idem `Cmd/Ctrl+I` para cursiva, `Cmd/Ctrl+E` para code inline, `Cmd/Ctrl+K` para link (abre popover para ingresar URL).
- **AC-2.2** — `Cmd/Ctrl+Z` y `Cmd/Ctrl+Shift+Z` operan sobre la historia del editor. La historia **es de la sesión de edición** — al cerrar el diálogo se pierde, sin persistencia cross-session (fuera de scope).
- **AC-2.3** — `Enter` en una lista o checklist crea el próximo ítem; `Enter` doble sale del bloque. `Tab` / `Shift+Tab` cambian el nivel de anidamiento hasta un máximo de 3.

### US-3 · bloques de contenido

- **AC-3.1** — Los nodos permitidos en el schema son exactamente:
  - **Bloque:** paragraph, heading (h1, h2, h3), bulletList, orderedList, taskList (con taskItem), blockquote, codeBlock (con atributo `language` opcional), horizontalRule.
  - **Inline:** text, hardBreak.
  - **Marks:** bold, italic, code, link (con `href`, `target=_blank`, `rel=noopener noreferrer` forzados).
  - **Bloque reservado sin toolbar:** image (declarado en el schema para `020`, no aparece en la toolbar ni acepta paste de `<img>` en esta feature).
- **AC-3.2** — Cualquier otro nodo o mark que llegue en un doc (via API o via paste) es descartado por el validador y por el paste sanitizer. No se transforma — se elimina.
- **AC-3.3** — Un checklist item (`taskItem`) tiene un checkbox interactivo: al marcarlo desde el **viewer** (no el editor), la fila cambia el atributo `checked` y **persiste** — es un edit del ticket, va por el mismo `PATCH /api/tickets/:key` y respeta la RLS. Un usuario que no puede editar la descripción no puede marcar checkboxes.
- **AC-3.4** — El code block resalta sintaxis con `lowlight` (subset de `highlight.js`) para los lenguajes: `bash`, `javascript`, `typescript`, `json`, `sql`, `python`, `html`, `css`, `plaintext`. La UI muestra un `<Select>` en la esquina del bloque para elegir el lenguaje.

### US-4 · paste limpio

- **AC-4.1** — Given copio texto desde Google Docs, Notion, Slack, Gmail o Word, when lo pego en el editor, then llega con **estructura preservada** (negritas, listas, links, headings, code blocks) pero **sin estilos inline, ni fuentes, ni colores, ni background, ni márgenes**.
- **AC-4.2** — Given pego un fragmento con nodos que no están en el schema (tablas, `<font>`, `<span style>`, iframes, imágenes remotas), when el paste sanitizer corre, then esos nodos se descartan y el resto del contenido se conserva. **No hay error visible** — el usuario ve solo lo que se pudo importar.
- **AC-4.3** — Given pego una URL sola (sin texto envolvente), when el editor detecta que es una URL bien formada (http/https), then la convierte automáticamente en un link con la URL como texto y href.
- **AC-4.4** — El paste de HTML plano y el paste de texto plano recorren el mismo pipeline (misma whitelist, mismo output).

### US-5 · viewer consistente

- **AC-5.1** — Given un ticket con `description_doc` no null, when abro `/tickets/[key]`, then el viewer renderiza los nodos del doc con los mismos estilos tipográficos que el editor: mismas escalas de heading, mismo tratamiento de code inline vs code block, mismos checkboxes, misma paleta de colores según `DESIGN.md`.
- **AC-5.2** — El viewer **corre server-side** (no requiere `"use client"` para renderizar) — convierte el JSON de ProseMirror a HTML sanitizado sin ejecutar Tiptap en el cliente. El único caso client-side es cuando el usuario marca un checkbox (interacción), que se resuelve con un pequeño client component acotado a esa fila.
- **AC-5.3** — Un ticket con `description_doc == null` pero con `description` (markdown viejo) no null se sigue viendo con el viewer de markdown actual (`MarkdownViewer`), sin degradación visual. Esta es la ruta de fallback para tickets que no llegaron a la migración; una vez migrados todos, es un caso teórico pero se mantiene por defensa.
- **AC-5.4** — Un ticket sin descripción (ambos campos null / vacíos) sigue mostrando el placeholder "Sin descripción" del viewer actual.

### US-6 · migración de descripciones existentes

- **AC-6.1** — La migration agrega `tickets.description_doc jsonb nullable`. La columna `tickets.description text` **no se toca** en esta feature — el drop es fase 2, aparte, después de verificar en producción.
- **AC-6.2** — Un script one-shot (`scripts/migrate-ticket-descriptions.mjs`) lee todos los tickets con `description` no vacío y `description_doc` null, convierte el markdown a JSON de ProseMirror con un parser server-side, y hace el update por lotes. Es **idempotente**: correrlo dos veces no cambia lo que ya migró.
- **AC-6.3** — El script tiene modo `--dry-run` que reporta cuántos tickets se convertirían y muestra los primeros 5 diffs, sin escribir.
- **AC-6.4** — Un ticket cuya conversión falla (markdown malformado que rompe el parser) se **loggea al stderr con su `key`** y se saltea — no aborta la corrida. El operador decide si edita esos tickets a mano después.
- **AC-6.5** — Después de la migración, el `PATCH /api/tickets/:key` **solo escribe `description_doc`** cuando el payload lo trae. `description` (la columna vieja) deja de recibir writes desde este release. La UI ya no expone un editor de markdown crudo.

### US-7 · contributor sigue sin poder editar descripción

- **AC-7.1** — Given soy contributor de un proyecto, when intento enviar un `PATCH /api/tickets/:key` con `descriptionDoc` en el body, then la request es aceptada por la API pero el trigger `enforce_ticket_contributor_scope` rechaza el `update` con el mismo error que hoy da para `description` — el status HTTP resultante es 403.
- **AC-7.2** — La whitelist del trigger **no se toca** en esta feature: es "whitelist positiva" (lo que sí puede tocar el contributor), así que `description_doc` nace protegido automáticamente. La migration incluye un comentario explícito recordando esa herencia.
- **AC-7.3** — En la UI, el diálogo de edición del ticket ya oculta el campo descripción para contributor (herencia de `015`). Este comportamiento no cambia.

---

## 5. Alcance

**Dentro:**
- Nueva columna `tickets.description_doc jsonb nullable`.
- Editor `<RichTextEditor>` client component basado en Tiptap con el schema definido en AC-3.1 (extensión `image` incluida en el schema pero **sin** botón en la toolbar y **sin** aceptar paste de `<img>`).
- Toolbar visible con los botones de AC-1.1 y los atajos de AC-2.1.
- Viewer server-side `<RichTextViewer>` que convierte JSON de ProseMirror a HTML sanitizado (helper `renderDocToHtml`).
- Checkbox interactivo en el viewer para `taskItem` (client component acotado).
- Zod schema para validar el body: `descriptionDoc` es un doc reconstruible contra el schema de Tiptap; falla → 400.
- Sanitizer de paste con whitelist estricta (mismo schema).
- Migration `scripts/migrate-ticket-descriptions.mjs` con modo `--dry-run`.
- Fallback: viewer de markdown existente sigue disponible para tickets con `description_doc == null`.
- Lazy import del bundle de Tiptap (`dynamic` en el diálogo de edición) para no pesar en la vista de solo lectura.
- Ajustes de `DESIGN.md` si aparecen: escala de headings dentro del editor, espaciado de bloques, estilos de code block. (No se prevén cambios, pero se declara la posibilidad).

**Fuera:**
- Upload de imágenes (feature `020-ticket-attachments`).
- Menciones `@usuario` con autocomplete + notificación (feature futura, no en el pipeline actual).
- Slash commands al estilo Notion (feature futura).
- Tablas (extensión aparte, suma bundle sin caso de uso claro hoy).
- Colaboración en tiempo real (Y.js) — requiere infra distinta.
- Auto-save / drafts locales — el flujo sigue siendo diálogo con "Cancelar / Guardar".
- Emoji picker dedicado (el del sistema alcanza).
- Editor rich text en otros campos del producto (objetivo de sprint, descripción de proyecto, etc.) — quedan como están.
- Drop de la columna `description` — fase 2, feature aparte, después de verificar en producción (regla de dos fases de `CLAUDE.md`).
- Búsqueda por texto en descripción (los filtros de tickets siguen sobre título).

---

## 6. Preguntas abiertas

- **Q-1** — ¿JSON o HTML como formato de persistencia? **Respondida: JSON de ProseMirror.** Estructura tipada contra el schema → sanitize una sola vez al guardar; render puro después.
- **Q-2** — ¿Cómo se maneja la coexistencia con descripciones ya escritas en markdown? **Respondida: dos columnas conviviendo, migración masiva antes del release, drop de la vieja en fase 2 aparte.** Sigue la regla del `CLAUDE.md` de nunca hacer un cambio breaking en una sola migration cuando hay usuarios.
- **Q-3** — ¿Extensiones incluidas en el MVP? **Respondida:** las de AC-3.1. Tablas, menciones, slash commands y colab quedan fuera; se pueden sumar después sin migration.
- **Q-4** — ¿La toolbar es sticky, colapsable, floating? **Abierta.** Preferencia inicial: **sticky arriba del editor** dentro del diálogo, siempre visible. Se decide en el plan mirando cómo queda con la altura del `Dialog` de shadcn.
- **Q-5** — ¿Link va con dialog modal o popover inline? **Abierta.** Preferencia inicial: **popover inline** al hacer `Cmd/Ctrl+K` o click en el botón, con dos inputs (texto y URL). Un dialog interrumpe más el flujo.
- **Q-6** — ¿El diálogo de edición del ticket muestra un aviso de "Cambios sin guardar" al cancelar si hubo edición? **Abierta.** Preferencia inicial: **sí**, con un confirm nativo o un `AlertDialog`, para no perder trabajo. Coordinar con el resto de los formularios de la app (probablemente no existe hoy y sería una addition transversal).
- **Q-7** — ¿El límite de 10.000 caracteres cuenta el texto plano o el JSON serializado? **Respondida: texto plano extraído.** Un doc con muchos formatos pesa más en JSON pero el usuario ve el mismo texto — contar el JSON penalizaría el uso rico.
- **Q-8** — ¿Se agrega `PATCH /api/tickets/:key/description-doc` como endpoint dedicado o se extiende el `PATCH /api/tickets/:key` actual? **Abierta.** Preferencia inicial: **extender el existente**, sumando `descriptionDoc` al schema del body. Un endpoint aparte solo se justifica si el guardado quisiera ser incremental (autosave), y no lo es.
- **Q-9** — ¿Cómo se comporta el paste de una imagen del portapapeles (screenshot con Cmd+Shift+Ctrl+4 → Cmd+V) en esta feature, sin `020` todavía? **Respondida: se ignora silenciosamente.** El sanitizer descarta el nodo `image` que llegue en el paste. `020` va a agregar el handler que sube y crea la fila; hasta entonces, la screenshot no llega al doc y no se sube a ningún lado.

---

## 7. Riesgos

- **R-1 · Paste sucio de terceros.** Google Docs, Notion y Outlook pegan HTML con `<font>`, `style="..."`, colores, backgrounds y clases propietarias. Sin sanitizer estricto, la descripción termina con tipografías rotas y colores fuera de la paleta. **Mitigación:** whitelist positiva en el schema (nada que no esté declarado sobrevive) + `transformPastedHTML` de Tiptap que aplica la whitelist antes de que el doc entre al estado del editor. La whitelist es la misma que usa el validador Zod del API — una única fuente de verdad para "qué es un doc legal".
- **R-2 · Migración de datos existentes.** El parser markdown→ProseMirror puede tropezar con markdown mal formado (listas anidadas sin cerrar, code blocks sin lenguaje, mezclas de sintaxis GFM y CommonMark). Un fallo silencioso convierte una descripción en JSON vacío. **Mitigación:** el script corre en modo `--dry-run` primero, reporta los fallos por `key` sin abortar, y solo escribe los que convirtió limpiamente. Los que fallan quedan con `description_doc = null` y siguen renderizando con el viewer viejo (AC-5.3) hasta que alguien los edite a mano.
- **R-3 · Bundle size.** Tiptap starter kit + ProseMirror + lowlight sumó ~90 KB gzipped en un prototipo. **Mitigación:** `dynamic()` import del `<RichTextEditor>` dentro del diálogo — el peso solo se carga cuando el usuario abre el form. El viewer no importa Tiptap; usa `renderDocToHtml` que es una función pura sobre el JSON con ~2 KB de peso.
- **R-4 · Viewer server-side sin Tiptap runtime.** Convertir el JSON de ProseMirror a HTML sin ejecutar el schema completo del editor requiere un renderer propio, y hay que asegurar que **coincida visualmente** con lo que muestra Tiptap en el editor. **Mitigación:** el renderer es una tabla de nodos y marks del schema mapeados a strings de HTML, testeada con snapshots contra los mismos docs renderizados en el editor. Si divergen, el test rompe.
- **R-5 · Checkbox interactivo desde el viewer abre puerta a mutaciones inesperadas.** Un click en un checkbox del viewer termina siendo un `PATCH /api/tickets/:key` que reemplaza `description_doc` entero — si dos usuarios marcan checkboxes al mismo tiempo, la última escritura gana y una tilde puede aparecer "revertida". **Mitigación:** el update de checkbox viaja con `expectedUpdatedAt` (mismo patrón que `bookings` en `005`), y el server rechaza con 409 si la descripción cambió entre la lectura y el click. La UI reintenta cargando el doc fresco y el usuario clickea de nuevo.
- **R-6 · Contributor accidental via API.** El trigger `enforce_ticket_contributor_scope` bloquea por whitelist positiva — cualquier columna no listada nace protegida (ADR 0009, principio heredado). `description_doc` cae adentro automáticamente. **Mitigación:** un test de integración explícito para "contributor no puede tocar `description_doc`", más un comentario en la migration que documenta la herencia (para el próximo lector).
- **R-7 · Undo history perdido al cerrar el diálogo.** El usuario abre el form, hace muchos cambios, cancela por accidente y pierde todo. **Mitigación:** Q-6 abierta — la propuesta es un confirm al cancelar cuando hubo edición. Si se decide no hacerlo, es una limitación aceptada y el copy del botón "Cancelar" no promete nada más.
- **R-8 · Contenido viejo con imágenes referenciadas por URL externa.** Si un ticket viejo tenía `![alt](https://...)` en markdown, el schema **no** acepta imágenes en esta feature. La conversión descarta esos nodos y el operador ve el `key` en el log. **Mitigación aceptada:** es un no-op consciente. `020` va a introducir el nodo `image` con upload propio; las imágenes viejas hosteadas afuera del bucket no se restauran automáticamente (fuera de scope, en la práctica no hay casos).

---

## 8. Dependencias

- **015** — tabla `tickets`, RLS, trigger `enforce_ticket_contributor_scope`, componentes `<TicketDetail>`, `<TicketFormDialog>`, `<MarkdownEditor>`, `<MarkdownViewer>`. El editor viejo se **reemplaza** en los call sites; el viewer viejo se **conserva** como fallback (AC-5.3).
- **No depende de 016, 017 ni 018.** Convive sin cambios con time tracking (los `time_entries` no tocan `description`), workspace kanban (el detalle abre igual) y sprints (el editor vive en el diálogo, ajeno al sprint).

---

## 9. Compatibilidad con features futuras

- **020-ticket-attachments** — el nodo `image` ya vive en el schema (AC-3.1) sin toolbar ni paste. `020` enciende el upload: agrega el botón "Insertar imagen" a la toolbar, el paste handler para screenshots, el drag & drop, y el pipeline que sube a `storage.objects` y crea la fila en `ticket_attachments`. **Cero cambios de schema en `tickets`.**
- **Menciones `@usuario`** — es una extensión de Tiptap propia (`@tiptap/extension-mention`). Suma un nodo `mention` al schema y una lista de sugerencias. Requiere una migration menor (por trigger de notificación al mencionado, si se elige notificar), pero **no** rompe docs existentes: el schema es aditivo.
- **Slash commands** — es UX, no schema. Se agrega un provider que escucha `/`, muestra un menú y aplica commands de Tiptap. Cero migración.
- **Tablas** — extensión aparte, aditiva al schema. Se decide cuando aparezca un caso real.
- **Colaboración en tiempo real (Y.js)** — cambia el modelo de persistencia (Yjs doc + snapshots) y requiere infra propia. Fuera de este pipeline, spec dedicada cuando corresponda.
- **Búsqueda de texto en descripción** — si en algún momento se agrega, se puede derivar el texto plano del `description_doc` con el mismo helper que se usa para el contador de caracteres, indexarlo en una columna generada (`GENERATED ALWAYS AS ... STORED`) y crear un índice `tsvector`. No es parte de este release.
