# Plan — Editor rich text para descripciones de tickets

- **ID:** 019-ticket-rich-editor
- **Spec reference:** `./spec.md`
- **Estado:** draft
- **Depende de:** `015-project-membership-and-tickets`

---

## 1. Resumen técnico

Una columna nueva en `tickets` (`description_doc jsonb`, nullable), un editor client component basado en Tiptap con schema propio, un viewer server-side que renderiza el JSON de ProseMirror a HTML sin ejecutar Tiptap en el cliente, un validador Zod que reconstruye el doc contra el schema al escribir, un sanitizer de paste compartiendo esa misma whitelist, y un script one-shot que migra los `description` markdown existentes a `description_doc`. La columna vieja `description text` **se conserva** — el drop es fase 2, feature aparte.

Sin cambios en RLS, sin nuevos triggers (excepto un comentario en el existente), sin nuevas rutas de API. Todo el trabajo se apoya en `PATCH /api/tickets/:id` extendido con dos campos nuevos en el body.

### Decisiones cerradas (del cuestionario + spec)

- **Tiptap/ProseMirror** como engine, **JSON** como formato de persistencia.
- **Doble columna** durante la transición (`description` + `description_doc`), con **drop en fase 2 aparte** después de verificar en producción.
- **Schema explícito** — nodos y marks listados en AC-3.1; nada más pasa el validador ni el paste sanitizer.
- **Nodo `image` en el schema pero sin toolbar ni paste handler** — reservado para `020`.
- **Viewer server-side** sin runtime de Tiptap: función `renderDocToHtml` propia + `<TaskItemCheckbox>` como único bolsillo client-side para la interacción.
- **Contributor scope heredado** — la whitelist positiva del trigger no se toca; `description_doc` nace protegida.
- **Longitud** = 10.000 caracteres **de texto plano extraído** del doc.

### Decisiones nuevas (Qs de la spec resueltas en el plan)

- **Q-4 (toolbar):** sticky arriba del editor dentro del `<DialogContent>`, siempre visible mientras se scrollea el contenido.
- **Q-5 (link):** popover inline anclado a la selección (dos inputs — texto y URL); se abre con click en el botón o con `Cmd/Ctrl+K`. Nada de `Dialog` modal.
- **Q-6 (confirm al cancelar):** sí, con `AlertDialog` de shadcn. Se activa cuando `descriptionDoc` cambió respecto al `initial`; si nada cambió, el cancel cierra directo. Acotado a `<TicketFormDialog>` por ahora — extenderlo a todos los formularios de la app queda fuera.
- **Q-8 (endpoint dedicado o extender):** extender `PATCH /api/tickets/:id`. Sumar `description_doc` al schema es más chico que un endpoint nuevo, y no hay caso de autosave que justifique separarlo.

---

## 2. Modelo de datos

### 2.1 Extensión a `tickets`

```sql
alter table public.tickets
  add column description_doc jsonb;

-- No hay índice — no se indexa por contenido y el jsonb se toca solo cuando
-- se lee el ticket, siempre con el resto de las columnas.
comment on column public.tickets.description_doc is
  'ProseMirror doc (JSON) — fuente de verdad post-019. La columna description '
  'queda como fallback hasta que fase 2 la borre; escrituras nuevas van solo '
  'a description_doc.';
```

Sin `not null`, sin default. Los tickets viejos quedan con `description_doc = null` hasta que el script de migración los procese o hasta que alguien los edite (lo primero que ocurra). El viewer sabe elegir la ruta (§5.3).

### 2.2 Columna `description` vieja

**No se modifica** en esta feature. Su drop llega en una migration posterior, en una feature dedicada (`019.5-drop-legacy-description` o similar). Rationale: la regla de dos fases del `CLAUDE.md` es explícita — "primero agregar, deployar, después borrar". Con usuarios en producción, un single-migration del cambio breakea el deploy anterior en el momento de correr `db:push`.

### 2.3 Trigger `enforce_ticket_contributor_scope`

**No se modifica.** La whitelist positiva (§529 de `00000000000014_project_membership_and_tickets.sql`) diffea `to_jsonb(new) - {'status','updated_at'}` contra `to_jsonb(old) - ...`, así que cualquier columna nueva de `tickets` cae adentro del bloqueo automáticamente para contributors ajenos al ticket, y adentro del bloqueo total para viewers.

La migration **sí agrega un `comment on function public.enforce_ticket_contributor_scope() is ...`** recordando la herencia — para el próximo lector que agregue otra columna y se pregunte si tiene que tocar el trigger. Se eligió el comentario en el catálogo (visible con `\df+`) por sobre insertar un comentario dentro del cuerpo de la función: eso obligaría a un `create or replace` con el cuerpo copiado byte-a-byte desde migration 16, y cualquier divergencia introduciría un bug de contributor scope sin ganar visibilidad práctica.

### 2.4 Trigger `audit_ticket_events`

**Se modifica** con la misma lógica que hoy usa para `description`: si el diff genérico incluye `description_doc`, se reemplaza por `'__changed__'` antes de escribir la fila (`00000000000014` §830). Motivo idéntico: el doc puede ser grande y ensuciar el `audit_log.diff`.

```sql
if diff ? 'description_doc' then
  diff := jsonb_set(diff, '{description_doc}', to_jsonb('__changed__'::text));
end if;
```

Sin esto, un `update` que cambia la descripción escribiría el JSON entero en el diff — kilobytes por edit.

---

## 3. Schema de ProseMirror

El schema es la única fuente de verdad de "qué es un doc válido". Se declara una vez en TypeScript y lo consumen tres lugares: el editor (Tiptap `Editor.configure({ extensions: ... })`), el validador Zod (reconstruye el doc para validarlo), y el renderer server-side (mapea nodos y marks a HTML).

### 3.1 Nodos permitidos

| Nodo             | Atributos                       | Origen                            |
|------------------|---------------------------------|-----------------------------------|
| `doc`            | —                               | ProseMirror core                  |
| `paragraph`      | —                               | starter-kit                       |
| `text`           | —                               | starter-kit                       |
| `heading`        | `level: 1 \| 2 \| 3`            | starter-kit (restringido a 1–3)   |
| `bulletList`     | —                               | starter-kit                       |
| `orderedList`    | `start: number`                 | starter-kit                       |
| `listItem`       | —                               | starter-kit                       |
| `taskList`       | —                               | `@tiptap/extension-task-list`     |
| `taskItem`       | `checked: boolean`              | `@tiptap/extension-task-item`     |
| `blockquote`     | —                               | starter-kit                       |
| `codeBlock`      | `language: string \| null`      | `@tiptap/extension-code-block-lowlight` |
| `horizontalRule` | —                               | starter-kit                       |
| `hardBreak`      | —                               | starter-kit                       |
| `image`          | `src, alt, title` (reservado)   | `@tiptap/extension-image` — declarado, sin toolbar ni paste handler |

### 3.2 Marks permitidas

| Mark    | Atributos                                    | Origen                             |
|---------|----------------------------------------------|------------------------------------|
| `bold`  | —                                            | starter-kit                        |
| `italic`| —                                            | starter-kit                        |
| `code`  | —                                            | starter-kit                        |
| `link`  | `href` (validado), `target=_blank`, `rel=noopener noreferrer` (forzados) | `@tiptap/extension-link` con `openOnClick=false`, `autolink=true`, `linkOnPaste=true` |

### 3.3 Nodo `image` — por qué en el schema pero deshabilitado

Declarar `image` acá tiene una única razón: **`020` no toca el schema**. Encender el upload se limita a (a) agregar el botón "Insertar imagen" a la toolbar, (b) agregar el paste handler que sube antes de insertar el nodo, (c) crear el bucket + tabla de attachments. El validador y el renderer ya saben qué hacer con un `image` porque el schema lo lista.

En `019` el nodo está pero:
- No aparece en la toolbar (`<ImageButton>` no se monta).
- El paste sanitizer descarta `<img>` que llegue en HTML pegado (whitelist negativa acotada solo a este nodo).
- El validador Zod rechaza docs con nodos `image` — mientras `020` no exista, un doc con imagen **no es válido**. Esto es defensivo por si un cliente malicioso arma un doc a mano contra la API.

### 3.4 `<Extension>` que NO se incluyen y por qué

- `@tiptap/extension-mention` — feature futura (menciones).
- `@tiptap/extension-table` — no hay caso de uso hoy; suma bundle.
- `@tiptap/extension-color`, `@tiptap/extension-highlight`, `@tiptap/extension-text-style` — colores rompen la consistencia visual del `DESIGN.md`.
- `@tiptap/extension-typography` — reemplaza `--` por `—`, `->` por `→`, comillas rectas por curvas. Nice-to-have; se puede sumar sin migración. **No** en el MVP.
- `@tiptap/extension-placeholder` — sí se incluye, es UX básica.

---

## 4. Componentes

### 4.1 `<RichTextEditor>` — client component

Archivo nuevo: `src/lib/editor/rich-text-editor.tsx`. Reemplaza al `<MarkdownEditor>` en los call sites de `TicketFormDialog`.

**Props:**
```ts
{
  value: JSONContent | null;         // doc de ProseMirror
  onChange: (doc: JSONContent, plainText: string) => void;
  onDirtyChange?: (dirty: boolean) => void;  // para el confirm al cancelar (Q-6)
  placeholder?: string;
  maxPlainTextLength?: number;       // default 10_000
  disabled?: boolean;
}
```

**Comportamiento:**
- Monta `useEditor` de Tiptap con las extensiones del §3.
- Toolbar sticky (`sticky top-0 z-10 bg-background`) con los botones de AC-1.1.
- El botón "Link" abre `<LinkPopover>` (§4.2).
- Cada `onUpdate` calcula `plainText` via `editor.getText()` y llama `onChange(doc, plainText)`.
- Si `plainText.length > maxPlainTextLength`, la última transacción se rechaza con `editor.commands.undo()` — sin toast, la key deja de ingresar. El contador cambia de color como hoy.
- `onDirtyChange` se dispara cuando el doc actual difiere del inicial (comparación por deep equal después de `JSON.stringify` — barato para docs de este tamaño).

**Lazy load:**
```tsx
// En TicketFormDialog
const RichTextEditor = dynamic(
  () => import("@/lib/editor/rich-text-editor").then(m => m.RichTextEditor),
  { ssr: false, loading: () => <EditorSkeleton /> }
);
```

Motivo: el bundle de Tiptap + ProseMirror + lowlight pesa ~90 KB gzipped y no lo necesita nadie que solo lea tickets. El skeleton es un `<div>` con la altura estimada para no saltar el layout.

### 4.2 `<LinkPopover>` — client component

Popover de shadcn anclado al botón "Link" y disparado por `Cmd/Ctrl+K`. Dos inputs (texto visible + URL), un botón "Aplicar" y otro "Quitar" (si la selección ya es un link). Validación de URL con `z.string().url()` — si no valida, el botón queda disabled.

Al aplicar: si hay selección, envuelve la selección con `setLink({ href })`; si no hay selección, inserta `text` como texto plano marcado con `link`. `href` sanea el scheme — solo `http`, `https`, `mailto` pasan (misma whitelist que el sanitizer, §5).

### 4.3 `<RichTextViewer>` — server component

Archivo nuevo: `src/lib/editor/rich-text-viewer.tsx`. Reemplaza al `<MarkdownViewer>` en `<TicketDetail>` cuando `description_doc !== null`.

**Props:**
```ts
{
  doc: JSONContent | null;
  className?: string;
  ticketId?: string;         // solo para permitir el checkbox interactivo
  canEditChecklist?: boolean;
  expectedUpdatedAt?: string;
}
```

**Comportamiento:**
- Si `doc == null` o `doc` es un doc vacío (un solo párrafo vacío) → placeholder "Sin descripción" (mismo copy que `MarkdownViewer`).
- Llama a `renderDocToHtml(doc)` (§5.5) — devuelve un `string` de HTML seguro. Se inyecta con `dangerouslySetInnerHTML`. **Es seguro** porque el HTML lo construye el renderer server-side desde el schema del §3 sin pasar por parseo de HTML de terceros.
- Los `taskItem` se emiten como `<li data-task-id="..." data-checked="true|false">` con un contenido que incluye una marca `<span data-task-item-marker>` para que el hidratador cliente los encuentre.
- Un pequeño client component `<TaskItemHydrator>` se monta encima y adjunta listeners a los checkboxes; al click, arma el `descriptionDoc` mutado con `checked` invertido, hace `PATCH` con `expectedUpdatedAt`, y `router.refresh()` al éxito.

### 4.4 `<TaskItemHydrator>` — client component

Nuevo, en `src/lib/editor/task-item-hydrator.tsx`. Chico (~50 líneas). Mount-only en el detalle del ticket, no en el diálogo (el diálogo tiene el editor completo).

- Recibe `doc`, `ticketId`, `expectedUpdatedAt`, `disabled`.
- En `useEffect`, encuentra los `<span data-task-item-marker>` en el DOM, mapea a la posición del nodo en el doc, monta un `<input type="checkbox">` React encima.
- Al click: usa `useSyncIndicator().start("Actualizando checklist")`, arma el nuevo `descriptionDoc`, hace `PATCH /api/tickets/:id` con `{ description_doc, expectedUpdatedAt }`, maneja 409 recargando.

### 4.5 `<MarkdownViewer>` — se mantiene

**No se toca.** Sigue siendo el fallback para `description` no null + `description_doc` null (AC-5.3). Cuando la columna vieja se borre (fase 2), este componente y su schema de sanitize se borran también.

---

## 5. Validación, sanitización y render

### 5.1 Whitelist única — `src/lib/editor/schema.ts`

Un archivo declara la whitelist de nodos, marks y sus atributos permitidos. Lo consumen tres consumidores:

1. **Tiptap** — se traduce en la lista de extensiones y sus configs.
2. **Zod validator** — reconstruye el doc contra la whitelist; cualquier nodo o mark fuera → falla de validación.
3. **`renderDocToHtml`** — dispatch table del nodo/mark → string HTML.

```ts
export const RICH_TEXT_SCHEMA = {
  nodes: {
    doc: {},
    paragraph: {},
    text: {},
    heading: { attrs: { level: [1, 2, 3] } },
    bulletList: {},
    orderedList: { attrs: { start: "number" } },
    listItem: {},
    taskList: {},
    taskItem: { attrs: { checked: "boolean" } },
    blockquote: {},
    codeBlock: { attrs: { language: ["bash","javascript","typescript","json","sql","python","html","css","plaintext", null] } },
    horizontalRule: {},
    hardBreak: {},
    image: { attrs: { src: "url", alt: "string?", title: "string?" } },  // reservado
  },
  marks: {
    bold: {},
    italic: {},
    code: {},
    link: { attrs: { href: { protocols: ["http","https","mailto"] } } },
  },
} as const;
```

### 5.2 Validador Zod

`src/lib/validation/rich-text.ts` exporta:

```ts
export const richTextDocSchema = z
  .unknown()
  .transform((value, ctx) => {
    const result = validateProseMirrorDoc(value, RICH_TEXT_SCHEMA);
    if (!result.ok) {
      result.errors.forEach((msg) => ctx.addIssue({ code: "custom", message: msg }));
      return z.NEVER;
    }
    return result.doc;
  });
```

`validateProseMirrorDoc` es una función recursiva que:
- Verifica `type === "doc"` en la raíz.
- Para cada nodo, verifica que `type` esté en la whitelist, que `attrs` cumplan los tipos declarados, que `content` (si aplica) sea válido.
- Para cada mark, verifica que `type` esté en la whitelist y que `attrs.href` (link) matchee la whitelist de protocolos.
- Extrae `plainText` (`Array.prototype.reduce` sobre nodos de texto) y valida `plainText.length <= 10_000`.
- Rechaza si el doc contiene nodo `image` (mientras `020` no exista).

**No** valida contra el schema completo de ProseMirror en runtime (evita bundlear `prosemirror-model` server-side); es un validador puro sobre el JSON.

### 5.3 Extensión de `updateTicketSchema` y `createTicketSchema`

`src/lib/validation/tickets.ts`:

```ts
export const createTicketSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description_doc: richTextDocSchema.nullable().optional(),
  // description text se acepta un release más como legacy read/write path
  // NO. En 019 el cliente ya no lo envía. El schema lo elimina.
  priority: ticketPriority.default("medium"),
  assignee_id: z.string().uuid().nullable().optional(),
});
```

**Decisión:** `description` (el string markdown) **se remueve** de los schemas `create` y `update` en `019`. La razón: el editor viejo desaparece de la UI, entonces ningún cliente legítimo lo va a mandar. Un cliente que lo mande recibe un 400 con "campo desconocido" — lo cual es correcto: el sistema pasó a `description_doc`.

`update` incorpora también un `expected_updated_at` opcional (usado por el `<TaskItemHydrator>`):

```ts
export const updateTicketSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description_doc: richTextDocSchema.nullable().optional(),
    status: ticketStatus.optional(),
    priority: ticketPriority.optional(),
    assignee_id: z.string().uuid().nullable().optional(),
    sprint_id: z.string().uuid().nullable().optional(),
    estimated_hours: z.number().nonnegative().max(999.99).nullable().optional(),
    expected_updated_at: z.string().datetime().optional(),
  })
  .refine((body) => Object.keys(body).some((k) => k !== "expected_updated_at" && (body as Record<string, unknown>)[k] !== undefined), {
    message: "Nada para actualizar",
  });
```

### 5.4 Extensión del handler `PATCH /api/tickets/:id`

Sumas al `route.ts`:

1. Si `parsed.data.expected_updated_at` viene, comparar contra `ticket.updated_at` **antes** del `update`. Si no matchea → 409 `{ reason: "conflict", currentUpdatedAt: ticket.updated_at }`. El cliente refetchea y reintenta.
2. Sumar `description_doc` al objeto del `.update({ ... })`. La escritura de `description` (columna vieja) **desaparece del PATCH** — solo se lee cuando `description_doc is null` (viewer fallback).
3. Traducciones de error: la validación del doc ya la hizo Zod (400); nada nuevo.

### 5.5 Renderer server-side — `renderDocToHtml`

Archivo `src/lib/editor/render.ts`. Función pura sin dependencias runtime de Tiptap.

```ts
export function renderDocToHtml(doc: JSONContent): string { ... }
```

**Enfoque:** dispatch table `type → (node, children) => string`. Cada handler escapa el texto con `escapeHtml`. Los `attrs.href` de link ya vinieron validados por el schema, pero el handler igual pasa por `escapeHtmlAttr` como defensa en profundidad.

Nodos que emiten estructuras específicas:
- `heading` → `<h1|h2|h3 class="text-...">`.
- `codeBlock` → `<pre><code class="language-{lang} hljs">…</code></pre>` con resaltado ya calculado (lowlight puede correr server-side, pesa poco).
- `taskItem` → `<li data-task-index="{i}" data-checked="…"><span data-task-item-marker></span>{children}</li>`.
- `link` → `<a href="…" target="_blank" rel="noopener noreferrer">`.

**Test de paridad visual:** un test unitario compara `renderDocToHtml(doc)` con el HTML que emitiría Tiptap para el mismo doc (`generateHTML(doc, extensions)` de `@tiptap/html`), verificando que el output visible al usuario es idéntico. Si divergen, el test rompe y hay que reajustar el renderer.

### 5.6 Paste sanitizer

Se instala el handler `transformPastedHTML` de Tiptap (via `EditorProps`):

```ts
{
  transformPastedHTML: (html) => sanitizePastedHtml(html, RICH_TEXT_SCHEMA),
}
```

`sanitizePastedHtml` (nueva función en `src/lib/editor/paste.ts`):

1. Parsea el HTML con `parse5` server-side o `DOMParser` client (esto vive en el editor, es client-only — `DOMParser` está OK).
2. Recorre el DOM y descarta cualquier tag no listado en un mapping `htmlTag → prosemirrorNode`. Los tags no listados se reemplazan por sus hijos (unwrap), no por vacío — así el texto no se pierde.
3. Descarta atributos que no son la whitelist (`style`, `class` no whitelisted, `id`, `on*`, `data-*` excepto los reservados).
4. Sanea `href` de `<a>` contra los tres protocolos permitidos.
5. **Descarta `<img>` completamente** (no unwrap) — no queremos ni el `alt` como texto huérfano.
6. Devuelve HTML normalizado. Tiptap lo re-parsea contra el schema y el que sobrevive es válido por construcción.

Complementariamente, `transformPastedText` autoconvierte URLs solas en links (AC-4.3) via la regex `linkOnPaste` de la extensión `Link`.

---

## 6. Migración de datos

### 6.1 Script `scripts/migrate-ticket-descriptions.mjs`

Nuevo. Node script one-shot. Se corre **una sola vez** contra el proyecto Supabase después de aplicar la migration 19 y antes de deployar el código que consume `description_doc`.

**Flags:**
- `--dry-run` — reporta cuántos convertiría y muestra los 5 primeros diffs; no escribe.
- `--limit N` — procesa a lo sumo N tickets (para pruebas escalonadas).
- Sin flag → procesa todos los pendientes.

**Pipeline por ticket:**
1. Selecciona tickets con `description is not null and description <> ''` y `description_doc is null`.
2. Convierte con `markdownToProseMirrorDoc(md)` — helper propio basado en `unified` + `remark-parse` + `remark-gfm` + una función que camina el AST de mdast y emite el JSON de ProseMirror del schema §3.
3. Valida con `validateProseMirrorDoc(doc, RICH_TEXT_SCHEMA)`.
4. Si valida: `update tickets set description_doc = <doc> where id = <id> and description_doc is null` (idempotente por la condición `is null`).
5. Si no valida (parseo roto o schema no matchea): loggea `[skip] <ticket_key>: <razón>` al stderr y sigue.

**Batching:** por lotes de 100. Log por lote de "N convertidos / M skipped / K restantes".

### 6.2 Casos borde del parser

- **Imágenes markdown (`![alt](url)`)** → descartadas (nodo `image` no permitido en `019`), el operador ve el `key` skippeado. R-8 de la spec.
- **HTML crudo en el markdown** → el parser mdast lo emite como `html` node; el converter lo descarta silenciosamente (no lo re-sanitiza, es más simple omitirlo).
- **Tablas GFM** → descartadas (el schema no las tiene). Log al stderr.
- **Task lists GFM (`- [ ]`)** → convertidas a `taskList` + `taskItem`.

### 6.3 Ejecución

Se documenta en el `tasks.md` como un paso manual del deploy:
1. `pnpm db:push` (aplica migration 19).
2. `node scripts/migrate-ticket-descriptions.mjs --dry-run` → revisar output.
3. `node scripts/migrate-ticket-descriptions.mjs` → correr real.
4. Verificar en dashboard de Supabase: `select count(*) from tickets where description_doc is not null` matchea lo esperado.
5. Deploy del código (`git push` a `main`).
6. Verificación manual en el detalle de 3-5 tickets viejos.

---

## 7. UI — cambios por archivo

### 7.1 `src/components/tickets/ticket-form-dialog.tsx`

- **Import swap:** `MarkdownEditor` → `RichTextEditor` (dynamic).
- **Estado del form:** `description: string` pasa a `descriptionDoc: JSONContent | null`. `TicketFormInitial` cambia el shape.
- **Body del PATCH/POST:** `description` pasa a `description_doc`. La condición `form.description.trim()` para "vacío" pasa a ser `plainTextOfDoc(doc).trim().length > 0` — un doc que solo tiene un párrafo vacío se envía como `null`.
- **`useOnDirtyChange`:** el editor reporta dirty; el `onClick` de "Cancelar" verifica dirty y abre `<ConfirmDiscardDialog>` (`AlertDialog` de shadcn) si dirty.
- El `<TicketFormDialog>` sigue recibiendo `initial.description` como opcional durante el período de coexistencia si el caller aún no migró — hay UN caller (`TicketDetail`, §7.2) y se cambia en el mismo PR.

### 7.2 `src/components/tickets/ticket-detail.tsx`

- **Import swap:** `MarkdownViewer` → helper interno `<TicketDescription doc={optimistic.descriptionDoc} legacyMarkdown={optimistic.description} ticketId={...} ...>` que elige la ruta:
  - `descriptionDoc != null` → `<RichTextViewer doc={descriptionDoc} .../>`.
  - Si no y `legacyMarkdown` no vacío → `<MarkdownViewer content={legacyMarkdown} />`.
  - Si no → `<RichTextViewer doc={null} />` (renderiza placeholder).
- **Optimistic state** para el checkbox interactivo: cuando `<TaskItemHydrator>` marca un item, actualiza `optimistic.descriptionDoc` localmente y dispara el PATCH.
- `editInitial.descriptionDoc = optimistic.descriptionDoc ?? convertMarkdownAdHoc(optimistic.description)` — si el ticket todavía no fue migrado (edge case si el operador salteó el script), la edición convierte al vuelo al abrir el diálogo. Nunca se guarda hasta que el usuario confirme.

### 7.3 `src/lib/tickets/query.ts` (si existe con esa función)

- El SELECT que arma `TicketWithProject` para el detalle y `TicketRow` para la lista suma `description_doc` a la lista de columnas.
- Los tipos derivados de `Database` se actualizan al correr `pnpm db:types` post-migration.

### 7.4 `src/lib/markdown/editor.tsx`

- **Se elimina.** El único caller (`TicketFormDialog`) ya no lo importa.
- El archivo se borra en el mismo PR — no dejar código muerto.

### 7.5 `src/lib/markdown/viewer.tsx` + `sanitize.ts`

- **Se conservan** — siguen siendo el fallback para tickets no migrados (AC-5.3).
- Se agrega un comentario arriba de `MarkdownViewer` explicando que es solo fallback y que va a desaparecer en la feature 019.5 (drop de columna).

---

## 8. Migrations

Una sola migration: `supabase/migrations/00000000000019_ticket_description_doc.sql`. Terminó siendo la migration **19** (y no la 18 como preveía la primera versión del plan) por un accidente descubierto al implementar: la base de producción tenía la versión 18 aplicada (`time_entries_start_time`) sin archivo local — deuda D-10 en `docs/deuda-tecnica.md`. La mitigación fue crear un stub idempotente para la 18 y numerar la de esta feature como 19.

Contenido:

1. `alter table public.tickets add column description_doc jsonb;`
2. `comment on column public.tickets.description_doc is '...'` (§2.1).
3. `create or replace function public.audit_ticket_events()` con el mismo cuerpo + el bloque `if diff ? 'description_doc' then ... end if;` (§2.4).
4. Comentario final en el trigger `enforce_ticket_contributor_scope` recordando la herencia de la whitelist positiva (§2.3).

**Two-phase safety:**
- Fase 1 (migration **19** + deploy del código de `019`): coexistencia. Los deploys anteriores no conocen `description_doc` pero tampoco lo consultan — sus queries `select ... from tickets` no filtran por esa columna, así que ignorarla es transparente. Ningún PATCH del código viejo va a intentar escribirla.
- Fase 2 (feature `019.5`, migration aparte, después de verificar): `alter table tickets drop column description;` + borrar `MarkdownViewer`, `sanitize.ts`, `viewer.tsx`, dependencias `react-markdown`, `remark-gfm`, `rehype-sanitize`.

---

## 9. Testing (aspiracional)

Sigue la política del proyecto — se documenta acá lo que la Phase de tests debería cubrir, aunque su ejecución quede abierta (misma línea que `015` Phase 9).

- **Unit — `validateProseMirrorDoc`:** docs válidos aceptados; docs con nodo `image` rechazados; docs con nodo desconocido rechazados; docs con `link.href` de scheme prohibido rechazados; `plainText.length > 10_000` rechazado; doc con `codeBlock.language = "cobol"` rechazado.
- **Unit — `renderDocToHtml`:** paridad visual con `generateHTML(doc, extensions)` de `@tiptap/html` para un catálogo de docs representativos (headings anidados, listas anidadas, checklist con items marcados/no marcados, blockquote con link, codeBlock con language, mezcla de todos).
- **Unit — `sanitizePastedHtml`:** paste de Google Docs (mock HTML con `<span style="font-family: Arial">`) → sin style; paste de Notion (con `data-block-id`) → data-* descartados; paste de `<img>` → descartado sin unwrap; paste de `<script>alert(1)</script>` → descartado; paste de `<a href="javascript:...">` → link descartado, texto conservado.
- **Unit — `markdownToProseMirrorDoc` (script):** markdown con task lists, code fences con language, headings anidados, links; conversión roundtrip aproximada (render del doc resultante contiene el mismo texto plano que el markdown original).
- **Integración (RLS + trigger):** contributor ajeno intentando `PATCH` con `description_doc` → 403 con hint. Escritura de admin/PM/lead → OK.
- **Integración (audit):** un update de `description_doc` deja una fila en `audit_log` con `diff.description_doc === '__changed__'`, sin el JSON completo.
- **Smoke:** `select id, description_doc from tickets where id = ...` devuelve el JSON parseado; PostgREST no corrompe el jsonb.
- **E2E (Playwright):** happy path — usuario abre el diálogo, escribe con toolbar, guarda, ve el resultado en el detalle idéntico al que vio en el editor.

---

## 10. Riesgos revisitados

- **R-1 (spec) — paste sucio.** Whitelist única `RICH_TEXT_SCHEMA` compartida por Tiptap (`transformPastedHTML`) y por el validador Zod. Un test unitario por caso conocido (Google Docs, Notion, Outlook, Slack, plain HTML con `<script>`).
- **R-2 (spec) — migración de datos.** Script con `--dry-run` + skip tolerante + log al stderr. Verificación manual del count antes y después. El operador puede corregir a mano los skippeados.
- **R-3 (spec) — bundle size.** `dynamic()` con `ssr: false` en `TicketFormDialog`. El viewer no importa Tiptap. Bundle del detalle de ticket **no crece**.
- **R-4 (spec) — divergencia visual editor vs viewer.** Test de paridad `renderDocToHtml` vs `generateHTML` como guardrail. Si diverge, rompe CI, no producción.
- **R-5 (spec) — carrera en checkbox.** `expected_updated_at` viaja en el PATCH del checkbox; 409 fuerza al cliente a recargar (`router.refresh()`) y el usuario clickea de nuevo. Es un edge case de dos usuarios simultáneos en la misma descripción; se puede vivir con "hacer click dos veces" ese caso.
- **R-6 (spec) — contributor.** Whitelist positiva del trigger heredada. Comentario en la migration recordándolo. Test de integración explícito propuesto.
- **R-7 (spec) — undo perdido al cancelar.** Resuelto con `<ConfirmDiscardDialog>` (Q-6). Se dispara solo si dirty.
- **R-8 (spec) — imágenes viejas por URL externa.** Descartadas en la migración con log. Feature aceptada.
- **R-9 (plan) — `audit_ticket_events` reemplaza a la versión existente.** Un `create or replace function` puede introducir un bug si el cuerpo nuevo diverge del viejo en algo no relacionado. **Mitigación:** el diff de la migration muestra literalmente una única línea agregada (el bloque `if diff ? 'description_doc'`); el resto del cuerpo se conserva byte-a-byte.
- **R-10 (plan) — `expected_updated_at` como opcional en el schema.** Un cliente que olvida enviarlo pasa el schema pero pierde la garantía de carrera. **Mitigación:** el schema lo hace opcional (los updates del `TicketFormDialog` no lo usan — el diálogo abre con datos frescos y se cierra al guardar, la ventana es mínima), pero el `<TaskItemHydrator>` **siempre** lo envía. El comentario del schema lo aclara.
- **R-11 (plan) — el converter markdown→JSON puede diverger de cómo Tiptap parsearía el mismo markdown.** El script no usa Tiptap para convertir (bundle grande + reinicializar el editor por ticket es caro). Un test compara la salida del script con la salida de `generateJSON` de `@tiptap/html` (que sí usa Tiptap) sobre un fixture de markdown de referencia; si divergen visualmente, se ajusta el converter.

---

## 11. Cierre

Al terminar:

1. Marcar 019 como done en `specs/features/README.md`.
2. Actualizar `CLAUDE.md`:
   - Sección de estructura del repo: nuevo `src/lib/editor/` con `rich-text-editor.tsx`, `rich-text-viewer.tsx`, `render.ts`, `paste.ts`, `schema.ts`, `task-item-hydrator.tsx`.
   - Sección "Convenciones de código > Editor rich text" con las reglas: "el schema es la única fuente de verdad", "el viewer server-side no importa Tiptap", "el `MarkdownViewer` sigue vivo hasta la fase 2 como fallback".
   - Sección "Estado de features" con la línea para 019.
   - Sección "Migrations" — recordatorio de que 019.5 (drop de `description`) queda pendiente como fase 2.
3. `DESIGN.md` §? — sumar entrada breve si aparece algún patrón visual reusable (toolbar sticky del editor, link popover, discard dialog). Probable adición: el `<AlertDialog>` para "descartar cambios" — si es nuevo en el sistema, documentarlo.
4. `docs/deuda-tecnica.md` — anotar la fase 2 pendiente ("drop de `tickets.description` + borrar `src/lib/markdown/*`") como deuda intencional con dueño y motivo. **No se salda sin OK explícito** (regla del `CLAUDE.md`).
5. Verificación manual del usuario en el browser: crear un ticket con formato variado, editarlo, ver un ticket viejo migrado, ver un ticket no migrado (si quedara alguno), pegar desde Google Docs, marcar un checkbox desde el detalle, cancelar edición con cambios y confirmar.
