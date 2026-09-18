import {
  NODES_DISABLED_IN_019,
  type RichTextAttrSpec,
  type RichTextSchema,
} from "./schema";

// Validador puro de un doc de ProseMirror contra la whitelist declarada en
// `./schema.ts`. Corre en el server (validando el `PATCH` de tickets) y en
// el script de migración (chequeando el output del converter markdown→JSON)
// sin importar `prosemirror-model` — el bundle server-side no lo necesita.
//
// Devuelve `{ ok: true, doc, plainText }` cuando el doc está sano, o
// `{ ok: false, errors }` con la lista de razones. El `plainText` extraído se
// usa para el cap de 10.000 caracteres del §5.2 del plan y para dejar un
// derivado en cache si algún día se agrega búsqueda full-text (F8).
//
// Filosofía de la validación: **whitelist positiva.** Un nodo, mark o attr
// que no está declarado en el schema es un error, no un warning silencioso.
// Los `attrs` no declarados también rebotan — así un cliente que arma el JSON
// a mano no puede colar un `onClick` en un `link` o un `style` en un `heading`.

export type ProseMirrorMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type ProseMirrorNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  marks?: ProseMirrorMark[];
  text?: string;
};

export type ValidationResult =
  | { ok: true; doc: ProseMirrorNode; plainText: string }
  | { ok: false; errors: string[] };

// Nodos que no tienen `content` — cualquier `content` presente en uno de
// éstos es motivo de error.
const LEAF_NODES = new Set(["text", "hardBreak", "horizontalRule", "image"]);

// Nodos que separan párrafos en el `plainText`: al terminar de visitar su
// contenido, se agrega un `\n` si el buffer no termina ya en `\n`.
const BLOCK_NODES_JOINING_NEWLINE = new Set([
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
]);

const DISABLED_NODES = new Set<string>(NODES_DISABLED_IN_019);

export function validateProseMirrorDoc(
  input: unknown,
  schema: RichTextSchema,
): ValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: ["Doc raíz debe ser un objeto"] };
  }

  const root = input as ProseMirrorNode;

  if (root.type !== "doc") {
    return {
      ok: false,
      errors: [`Doc raíz debe tener type "doc", recibido ${JSON.stringify(root.type)}`],
    };
  }

  const plainTextChunks: string[] = [];

  visitNode(root, schema, [], errors, plainTextChunks);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    doc: root,
    plainText: plainTextChunks.join("").trimEnd(),
  };
}

function visitNode(
  node: ProseMirrorNode,
  schema: RichTextSchema,
  path: string[],
  errors: string[],
  plainText: string[],
): void {
  const label = path.length === 0 ? "doc" : path.join(" > ");

  if (!isPlainObject(node)) {
    errors.push(`${label}: nodo debe ser un objeto`);
    return;
  }

  if (typeof node.type !== "string") {
    errors.push(`${label}: nodo debe tener type string`);
    return;
  }

  if (DISABLED_NODES.has(node.type)) {
    errors.push(
      `${label}: nodo "${node.type}" no está permitido en 019 (reservado para feature futura)`,
    );
    return;
  }

  const nodeSpec = schema.nodes[node.type];
  if (!nodeSpec) {
    errors.push(`${label}: nodo desconocido "${node.type}"`);
    return;
  }

  // Attrs
  validateAttrs(node.attrs, nodeSpec.attrs, `${label}.attrs`, errors);

  // Text
  if (node.type === "text") {
    if (typeof node.text !== "string") {
      errors.push(`${label}: nodo text debe tener campo text (string)`);
      return;
    }
    if (node.content !== undefined) {
      errors.push(`${label}: nodo text no puede tener content`);
    }
    plainText.push(node.text);
    validateMarks(node.marks, schema, `${label}.marks`, errors);
    return;
  }

  if (node.text !== undefined) {
    errors.push(`${label}: solo el nodo text puede tener campo text`);
  }

  // Marks (paragraph puede tener marks en algunos schemas; acá solo text)
  if (node.marks !== undefined && node.type !== "text") {
    errors.push(`${label}: marks solo se permiten en nodos text`);
  }

  // Content
  if (LEAF_NODES.has(node.type)) {
    if (node.content !== undefined && node.content.length > 0) {
      errors.push(`${label}: nodo leaf "${node.type}" no puede tener content`);
    }
  } else if (node.content !== undefined) {
    if (!Array.isArray(node.content)) {
      errors.push(`${label}.content: debe ser un array`);
    } else {
      node.content.forEach((child, i) => {
        visitNode(child, schema, [...path, `${node.type}[${i}]`], errors, plainText);
      });
    }
  }

  // hardBreak / horizontalRule agregan un salto al plainText.
  if (node.type === "hardBreak") {
    appendNewlineIfNeeded(plainText);
  }

  if (BLOCK_NODES_JOINING_NEWLINE.has(node.type)) {
    appendNewlineIfNeeded(plainText);
  }
}

function validateAttrs(
  attrs: Record<string, unknown> | undefined,
  spec: Record<string, RichTextAttrSpec> | undefined,
  label: string,
  errors: string[],
): void {
  const specKeys = spec ? Object.keys(spec) : [];
  const attrKeys = attrs ? Object.keys(attrs) : [];

  // Attrs no declaradas → error (whitelist positiva), pero solo si tienen
  // valor real. Tiptap serializa attrs default (`target`, `rel`, `class` en el
  // link mark, por ejemplo) con `null` cuando el usuario no las tocó — eso es
  // "ghost data", no un intento de inyectar algo. Si alguien manda un `target`
  // con string cualquiera, cae acá y rebota como debe.
  for (const key of attrKeys) {
    if (specKeys.includes(key)) continue;
    const value = attrs?.[key];
    if (value === null || value === undefined) continue;
    errors.push(`${label}: attr desconocida "${key}"`);
  }

  if (!spec) return;

  for (const key of specKeys) {
    const attrSpec = spec[key]!;
    const value = attrs?.[key];

    if (value === undefined || value === null) {
      if (!attrSpec.optional) {
        errors.push(`${label}.${key}: attr requerida, ausente`);
      }
      continue;
    }

    validateAttrValue(value, attrSpec, `${label}.${key}`, errors);
  }
}

function validateAttrValue(
  value: unknown,
  spec: RichTextAttrSpec,
  label: string,
  errors: string[],
): void {
  switch (spec.type) {
    case "enum": {
      if (!spec.values.includes(value as string | number | boolean | null)) {
        errors.push(
          `${label}: valor ${JSON.stringify(value)} fuera de la whitelist ${JSON.stringify(spec.values)}`,
        );
      }
      return;
    }
    case "primitive": {
      if (typeof value !== spec.kind) {
        errors.push(`${label}: se esperaba ${spec.kind}, recibido ${typeof value}`);
      }
      return;
    }
    case "url": {
      if (typeof value !== "string") {
        errors.push(`${label}: se esperaba string (url), recibido ${typeof value}`);
        return;
      }
      const protocol = extractProtocol(value);
      if (!protocol || !spec.protocols.includes(protocol)) {
        errors.push(
          `${label}: protocolo ${JSON.stringify(protocol)} fuera de la whitelist ${JSON.stringify(spec.protocols)}`,
        );
      }
      return;
    }
  }
}

function validateMarks(
  marks: ProseMirrorMark[] | undefined,
  schema: RichTextSchema,
  label: string,
  errors: string[],
): void {
  if (marks === undefined) return;
  if (!Array.isArray(marks)) {
    errors.push(`${label}: debe ser un array`);
    return;
  }
  marks.forEach((mark, i) => {
    if (!isPlainObject(mark) || typeof mark.type !== "string") {
      errors.push(`${label}[${i}]: mark debe ser un objeto con type string`);
      return;
    }
    const markSpec = schema.marks[mark.type];
    if (!markSpec) {
      errors.push(`${label}[${i}]: mark desconocido "${mark.type}"`);
      return;
    }
    validateAttrs(mark.attrs, markSpec.attrs, `${label}[${i}].attrs`, errors);
  });
}

function extractProtocol(url: string): string | null {
  // Formato válido: `<scheme>:<rest>`. Rechaza URLs sin protocolo (evita que
  // `//example.com` o `example.com` pasen — un href sin scheme queda expuesto
  // al basename del documento y no queremos esa ambigüedad en descripciones).
  const match = /^([a-z][a-z0-9+\-.]*):/i.exec(url);
  return match ? match[1]!.toLowerCase() : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendNewlineIfNeeded(buffer: string[]): void {
  const last = buffer.length > 0 ? buffer[buffer.length - 1]! : "";
  if (!last.endsWith("\n")) {
    buffer.push("\n");
  }
}
