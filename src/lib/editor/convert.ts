import type {
  Blockquote,
  Code,
  Content,
  Heading,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  Text,
} from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { CODE_BLOCK_LANGUAGES, LINK_PROTOCOLS, type CodeBlockLanguage } from "./schema";
import type { ProseMirrorMark, ProseMirrorNode } from "./validate";

// Convierte markdown a un doc de ProseMirror que respeta `RICH_TEXT_SCHEMA`.
// Se comparte entre dos caminos:
//
//   1. **Script de migración** (`scripts/migrate-ticket-descriptions.mjs`):
//      corre una sola vez por ticket viejo, convierte el markdown que había
//      en `tickets.description` y escribe el resultado en `description_doc`.
//   2. **Fallback en el detalle** (`<TicketDescription>` en
//      `ticket-detail.tsx`): si un ticket llegó al editor sin ser migrado
//      (parseo roto durante el script, o edición antes del run), la
//      conversión se hace al vuelo para no perder el contenido.
//
// El converter no es "perfecto" — imágenes, HTML crudo y tablas se
// descartan porque el schema de 019 no los soporta. Cada descarte se loguea
// con `console.warn` con la razón. El objetivo es "mejor esfuerzo, sin tirar
// nunca": un markdown roto tiene que producir *algún* doc válido, aunque
// sea vacío. La regla dura la aplica el validador después de esto.

const processor = unified().use(remarkParse).use(remarkGfm);

const CODE_LANGS = new Set<string>(CODE_BLOCK_LANGUAGES);
const LINK_PROTOS = new Set<string>(LINK_PROTOCOLS);

export function markdownToProseMirrorDoc(md: string): ProseMirrorNode {
  const trimmed = md.trim();
  if (trimmed.length === 0) {
    return emptyDoc();
  }

  let tree: Root;
  try {
    tree = processor.parse(trimmed) as Root;
  } catch (error) {
    console.warn("[convert] markdown parse falló, doc vacío:", error);
    return emptyDoc();
  }

  const content = convertChildren(tree.children);
  if (content.length === 0) {
    return emptyDoc();
  }
  return { type: "doc", content };
}

// ─────────────────────────────────────────────────────────────
// Bloques
// ─────────────────────────────────────────────────────────────

function convertChildren(children: Content[]): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  for (const node of children) {
    const converted = convertBlock(node);
    if (converted) out.push(converted);
  }
  return out;
}

function convertBlock(node: Content): ProseMirrorNode | null {
  switch (node.type) {
    case "paragraph":
      return convertParagraph(node);
    case "heading":
      return convertHeading(node);
    case "blockquote":
      return convertBlockquote(node);
    case "list":
      return convertList(node);
    case "code":
      return convertCodeBlock(node);
    case "thematicBreak":
      return { type: "horizontalRule" };

    case "html":
      // HTML crudo (por ejemplo `<div>...</div>` dentro del markdown) no
      // pasa por el schema — se descarta. Es raro en tickets, pero el
      // markdown lo permite y algunos exports de otras herramientas lo emiten.
      console.warn("[convert] HTML crudo descartado");
      return null;

    case "table":
      console.warn("[convert] Tabla descartada (no está en el schema de 019)");
      return null;

    default:
      console.warn(`[convert] Nodo mdast desconocido descartado: ${node.type}`);
      return null;
  }
}

function convertParagraph(node: Paragraph): ProseMirrorNode {
  const content = convertInline(node.children);
  // Un párrafo vacío es válido en ProseMirror; devolverlo evita huecos
  // raros en documentos que abren con una línea en blanco.
  return { type: "paragraph", content: content.length > 0 ? content : undefined };
}

function convertHeading(node: Heading): ProseMirrorNode {
  // H4/H5/H6 caen a H3 — el schema solo permite 1-3 y perder la jerarquía
  // es preferible a perder el heading entero.
  const level = Math.min(Math.max(node.depth, 1), 3) as 1 | 2 | 3;
  const content = convertInline(node.children);
  return {
    type: "heading",
    attrs: { level },
    content: content.length > 0 ? content : undefined,
  };
}

function convertBlockquote(node: Blockquote): ProseMirrorNode {
  const content = convertChildren(node.children as Content[]);
  return { type: "blockquote", content };
}

function convertList(node: List): ProseMirrorNode {
  // Task list GFM: cualquier item con `checked !== null | undefined` promueve
  // la lista entera a taskList (el schema no mezcla task e items normales).
  const hasTaskItem = node.children.some(
    (item) => item.checked !== null && item.checked !== undefined,
  );

  if (hasTaskItem) {
    return {
      type: "taskList",
      content: node.children.map(convertTaskItem),
    };
  }

  if (node.ordered) {
    const attrs: Record<string, unknown> = {};
    if (typeof node.start === "number" && node.start !== 1) {
      attrs.start = node.start;
    }
    return {
      type: "orderedList",
      ...(Object.keys(attrs).length > 0 && { attrs }),
      content: node.children.map(convertListItem),
    };
  }

  return {
    type: "bulletList",
    content: node.children.map(convertListItem),
  };
}

function convertListItem(item: ListItem): ProseMirrorNode {
  const content = convertChildren(item.children as Content[]);
  return { type: "listItem", content };
}

function convertTaskItem(item: ListItem): ProseMirrorNode {
  const content = convertChildren(item.children as Content[]);
  return {
    type: "taskItem",
    attrs: { checked: item.checked === true },
    content,
  };
}

function convertCodeBlock(node: Code): ProseMirrorNode {
  const rawLang = (node.lang ?? "").toLowerCase();
  const language: CodeBlockLanguage | null = CODE_LANGS.has(rawLang)
    ? (rawLang as CodeBlockLanguage)
    : rawLang.length > 0
      ? "plaintext"
      : null;
  return {
    type: "codeBlock",
    attrs: { language },
    content: node.value.length > 0 ? [{ type: "text", text: node.value }] : undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// Inline
// ─────────────────────────────────────────────────────────────

function convertInline(children: PhrasingContent[]): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  for (const node of children) {
    convertInlineNode(node, [], out);
  }
  return out;
}

function convertInlineNode(
  node: PhrasingContent,
  activeMarks: ProseMirrorMark[],
  out: ProseMirrorNode[],
): void {
  switch (node.type) {
    case "text":
      pushText((node as Text).value, activeMarks, out);
      return;

    case "strong":
      for (const child of node.children) {
        convertInlineNode(child, addMark(activeMarks, { type: "bold" }), out);
      }
      return;

    case "emphasis":
      for (const child of node.children) {
        convertInlineNode(child, addMark(activeMarks, { type: "italic" }), out);
      }
      return;

    case "inlineCode": {
      pushText(node.value, addMark(activeMarks, { type: "code" }), out);
      return;
    }

    case "link":
      convertLink(node, activeMarks, out);
      return;

    case "break":
      out.push({ type: "hardBreak" });
      return;

    case "image":
      console.warn(`[convert] Imagen markdown descartada: ${node.url}`);
      // Conservar el alt como texto si existe — perder la url es peor que
      // perder el texto alternativo.
      if (node.alt && node.alt.trim().length > 0) {
        pushText(node.alt, activeMarks, out);
      }
      return;

    case "html":
      console.warn("[convert] HTML inline descartado");
      return;

    default:
      // Otros nodos inline (imageReference, linkReference, footnote…) no
      // aparecen en descripciones de tickets. Se descartan silenciosamente.
      return;
  }
}

function convertLink(node: Link, activeMarks: ProseMirrorMark[], out: ProseMirrorNode[]): void {
  const url = node.url?.trim() ?? "";
  const protocol = extractProtocol(url);

  if (!protocol || !LINK_PROTOS.has(protocol)) {
    // Link con protocolo inválido: se descarta el link, se conserva el texto
    // de adentro sin el mark.
    console.warn(`[convert] Link con protocolo inválido descartado: ${url}`);
    for (const child of node.children) {
      convertInlineNode(child, activeMarks, out);
    }
    return;
  }

  const linkMark: ProseMirrorMark = { type: "link", attrs: { href: url } };
  for (const child of node.children) {
    convertInlineNode(child, addMark(activeMarks, linkMark), out);
  }
}

function pushText(text: string, marks: ProseMirrorMark[], out: ProseMirrorNode[]): void {
  if (text.length === 0) return;
  const node: ProseMirrorNode = { type: "text", text };
  if (marks.length > 0) {
    node.marks = marks;
  }
  out.push(node);
}

function addMark(existing: ProseMirrorMark[], mark: ProseMirrorMark): ProseMirrorMark[] {
  // No duplicar marks: si ya está una del mismo type, se conserva la
  // existente (la de más adentro gana en el markdown, pero el efecto visual
  // es el mismo).
  if (existing.some((m) => m.type === mark.type)) return existing;
  return [...existing, mark];
}

function extractProtocol(url: string): string | null {
  const match = /^([a-z][a-z0-9+\-.]*):/i.exec(url);
  return match ? match[1]!.toLowerCase() : null;
}

function emptyDoc(): ProseMirrorNode {
  return { type: "doc", content: [{ type: "paragraph" }] };
}
