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

// Protocolos que un `image.src` puede tener. El nodo `image` está declarado en
// el schema pero no se activa en la toolbar ni en el paste handler hasta
// `020-images-and-attachments`; el validador rechaza docs con `image` mientras
// tanto (ver `validate.ts`). La lista queda por consistencia con el diseño
// futuro.
export const IMAGE_PROTOCOLS = ["http", "https"] as const;

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
    // Reservado para 020. El validador rechaza docs con este nodo mientras
    // tanto — es defensivo por si un cliente arma un doc a mano contra la API.
    image: {
      attrs: {
        src: { type: "url", protocols: IMAGE_PROTOCOLS },
        alt: { type: "primitive", kind: "string", optional: true },
        title: { type: "primitive", kind: "string", optional: true },
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
      },
    },
  },
} satisfies RichTextSchema;

export type RichTextNodeType = keyof typeof RICH_TEXT_SCHEMA.nodes;
export type RichTextMarkType = keyof typeof RICH_TEXT_SCHEMA.marks;

// Nodos que no pueden aparecer en un doc válido de 019, aunque estén
// declarados en el schema para futuro (§3.3 del plan). Se exporta para que
// el validador chequee la exclusión en un solo lugar.
export const NODES_DISABLED_IN_019 = ["image"] as const;

export type NodeDisabledIn019 = (typeof NODES_DISABLED_IN_019)[number];
