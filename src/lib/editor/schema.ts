// Whitelist única de nodos y marks del editor rich text (feature 019).
//
// Los tres consumidores del rich text la usan a partir de este único archivo:
//
//   1. Tiptap (`tiptap-extensions.ts`) traduce cada entry a la config de la
//      extensión correspondiente — sin mirar la whitelist, un paste sucio o
//      un nodo nuevo podrían entrar al editor sin pasar por el validador.
//   2. El validador Zod (`../validation/rich-text.ts` + `./validate.ts`)
//      reconstruye el doc contra esta whitelist antes de aceptar cualquier
//      PATCH — es la línea de defensa contra un cliente malicioso que arme
//      el JSON a mano.
//   3. El renderer server-side (`./render.ts`) despacha por tipo de nodo/
//      mark y usa la lista de protocolos de `link.href` como último saneo
//      antes de emitir el atributo.
//
// Cambiar la whitelist es cambiar los tres a la vez. Si aparece un nodo
// nuevo (p.ej. `mention`, `table`), va sumado acá primero y después en cada
// consumidor — no al revés.

export type RichTextAttrSpec =
  | { type: "enum"; values: readonly (string | number | boolean | null)[]; optional?: boolean }
  | { type: "primitive"; kind: "string" | "number" | "boolean"; optional?: boolean }
  | { type: "url"; protocols: readonly string[]; optional?: boolean };

export interface RichTextNodeSpec {
  attrs?: Record<string, RichTextAttrSpec>;
}

export interface RichTextMarkSpec {
  attrs?: Record<string, RichTextAttrSpec>;
}

export interface RichTextSchema {
  nodes: Record<string, RichTextNodeSpec>;
  marks: Record<string, RichTextMarkSpec>;
}

// Lenguajes que el `codeBlock` acepta. `null` es válido — un bloque sin
// language se emite como `<pre><code>` sin clase de lowlight. La lista
// coincide con la config de `@tiptap/extension-code-block-lowlight` que
// se cablea en `tiptap-extensions.ts`.
export const CODE_BLOCK_LANGUAGES = [
  "bash",
  "javascript",
  "typescript",
  "json",
  "sql",
  "python",
  "html",
  "css",
  "plaintext",
] as const;

export type CodeBlockLanguage = (typeof CODE_BLOCK_LANGUAGES)[number];

// Protocolos que un `link.href` puede tener. Un href con otro esquema
// (`javascript:`, `data:`, `file:`) es rechazado por el validador y descartado
// por el sanitizer de paste antes de llegar al editor.
export const LINK_PROTOCOLS = ["http", "https", "mailto"] as const;

// (La constante `IMAGE_PROTOCOLS` existía mientras el nodo `image` llevaba un
// attr `src` tipo url; `026` reemplazó ese modelo por `attachment_id` apuntando
// a `ticket_attachments.id`, así que el chequeo de protocolo deja de aplicar
// — las URLs las arma el renderer server-side con signed URLs del bucket).

export const RICH_TEXT_SCHEMA = {
  nodes: {
    doc: {},
    paragraph: {},
    text: {},
    heading: {
      attrs: {
        level: { type: "enum", values: [1, 2, 3] },
      },
    },
    bulletList: {},
    orderedList: {
      attrs: {
        start: { type: "primitive", kind: "number", optional: true },
      },
    },
    listItem: {},
    taskList: {},
    taskItem: {
      attrs: {
        checked: { type: "primitive", kind: "boolean" },
      },
    },
    blockquote: {},
    codeBlock: {
      attrs: {
        language: {
          type: "enum",
          values: [...CODE_BLOCK_LANGUAGES, null],
          optional: true,
        },
      },
    },
    horizontalRule: {},
    hardBreak: {},
    // 026. Nodo activo: se inserta por `handlePaste` / `handleDrop` del editor
    // (ver `src/lib/editor/paste-image.ts`). El attr `attachment_id` apunta a
    // una fila de `ticket_attachments` del mismo ticket — el validador remata
    // el formato uuid acá (igual que `mention.user_id`), y el renderer
    // server-side chequea cross-tenant (`attachment.ticket_id === ticketId`)
    // antes de emitir el `<img>`. `src` NO vive en el schema: el nodo no
    // acarrea URL, el renderer la arma firmando el `object_key` del attachment.
    image: {
      attrs: {
        attachment_id: { type: "primitive", kind: "string" },
        alt: { type: "primitive", kind: "string", optional: true },
        width: { type: "primitive", kind: "number", optional: true },
        height: { type: "primitive", kind: "number", optional: true },
      },
    },
    // 022. Habilitado tanto en comentarios como en descripciones. El validador
    // chequea que `user_id` matchee formato uuid (kind: "string" solo garantiza
    // shape, no formato) y que sea un miembro activo del proyecto (chequeo
    // aplicativo en el handler que crea/edita — la RLS no lo puede expresar).
    mention: {
      attrs: {
        user_id: { type: "primitive", kind: "string" },
        label: { type: "primitive", kind: "string" },
      },
    },
  },
  marks: {
    bold: {},
    italic: {},
    code: {},
    link: {
      attrs: {
        href: { type: "url", protocols: LINK_PROTOCOLS },
        // Los cuatro attrs siguientes son "cosméticos" — la extensión Link de
        // Tiptap los declara con default null. El renderer server-side los
        // ignora y hardcodea `target="_blank" rel="noopener noreferrer"` en
        // el HTML final, así que su valor en el JSON no cambia lo que ve el
        // usuario. Se declaran acá como opcionales para no rebotar docs
        // guardados que los traigan como strings (docs pre-fix o docs que
        // venían con esos attrs seteados por autolink/paste antes de que se
        // saque `HTMLAttributes` de la config).
        target: { type: "primitive", kind: "string", optional: true },
        rel: { type: "primitive", kind: "string", optional: true },
        class: { type: "primitive", kind: "string", optional: true },
        title: { type: "primitive", kind: "string", optional: true },
      },
    },
  },
} satisfies RichTextSchema;

export type RichTextNodeType = keyof typeof RICH_TEXT_SCHEMA.nodes;
export type RichTextMarkType = keyof typeof RICH_TEXT_SCHEMA.marks;

// Nodos declarados en el schema pero inhabilitados en runtime. `019` tenía
// aquí `image` (reservado para 020/026); `026` lo encendió, así que la lista
// quedó vacía. Se preserva como punto de extensión: cuando aparezca un nodo
// reservado nuevo (ej. `table`, `embed`), se suma acá y el validador lo
// rechaza en un solo lugar sin tocar la whitelist principal.
export const DISABLED_NODES_IN_SCHEMA = [] as const;

export type DisabledNodeInSchema = (typeof DISABLED_NODES_IN_SCHEMA)[number];
