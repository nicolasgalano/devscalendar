import { toHtml } from "hast-util-to-html";
import { common, createLowlight } from "lowlight";

import {
  CODE_BLOCK_LANGUAGES,
  LINK_PROTOCOLS,
  type CodeBlockLanguage,
} from "./schema";
import {
  type ProseMirrorMark,
  type ProseMirrorNode,
} from "./validate";

// Renderer server-side puro. Toma un doc validado (post-`richTextDocSchema`)
// y emite HTML — sin cargar Tiptap ni ProseMirror en el server. La contra-
// partida es que si el output diverge de lo que Tiptap muestra dentro del
// editor, el usuario ve una cosa mientras edita y otra al leer. La mitigación
// vive en el test de paridad (`renderDocToHtml(doc)` vs `generateHTML(doc,
// extensions)` de `@tiptap/html`); ver R-4 del plan §10.
//
// Seguridad: el HTML se construye acá desde el JSON validado, sin pasar por
// ningún parseo de HTML de terceros. Cada atributo y cada texto pasa por
// `escapeAttr` y `escapeText` respectivamente. El caller inyecta el string
// con `dangerouslySetInnerHTML` sin más saneo — el saneo ES este archivo.

const lowlight = createLowlight(common);

// Índice global del `taskItem` visitado. Se usa como `data-task-index` en el
// HTML para que el hidratador cliente (`<TaskItemHydrator>`) sepa a qué nodo
// del doc corresponde cada checkbox visible. Vive en el walker, no como
// estado global — se resetea por invocación.

type RenderContext = {
  taskItemCount: number;
};

export function renderDocToHtml(doc: ProseMirrorNode): string {
  if (doc.type !== "doc") {
    return "";
  }
  const ctx: RenderContext = { taskItemCount: 0 };
  return renderChildren(doc.content, ctx);
}

function renderChildren(nodes: ProseMirrorNode[] | undefined, ctx: RenderContext): string {
  if (!nodes || nodes.length === 0) return "";
  return nodes.map((child) => renderNode(child, ctx)).join("");
}

function renderNode(node: ProseMirrorNode, ctx: RenderContext): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${renderChildren(node.content, ctx)}</p>`;

    case "heading": {
      const level = Number(node.attrs?.level ?? 1);
      const safeLevel = level === 1 || level === 2 || level === 3 ? level : 1;
      return `<h${safeLevel}>${renderChildren(node.content, ctx)}</h${safeLevel}>`;
    }

    case "bulletList":
      return `<ul>${renderChildren(node.content, ctx)}</ul>`;

    case "orderedList": {
      const start = node.attrs?.start;
      const startAttr = typeof start === "number" && start !== 1 ? ` start="${start}"` : "";
      return `<ol${startAttr}>${renderChildren(node.content, ctx)}</ol>`;
    }

    case "listItem":
      return `<li>${renderChildren(node.content, ctx)}</li>`;

    case "taskList":
      return `<ul data-task-list>${renderChildren(node.content, ctx)}</ul>`;

    case "taskItem": {
      const index = ctx.taskItemCount++;
      const checked = node.attrs?.checked === true;
      // El `<span data-task-item-marker>` es el ancla que el `<TaskItemHydrator>`
      // busca en el DOM para montar un checkbox React encima. Está dentro del
      // `<li>` para heredar el flex row del CSS del task item.
      return (
        `<li data-task-index="${index}" data-checked="${checked ? "true" : "false"}">` +
        `<span data-task-item-marker></span>` +
        `<div data-task-item-content>${renderChildren(node.content, ctx)}</div>` +
        `</li>`
      );
    }

    case "blockquote":
      return `<blockquote>${renderChildren(node.content, ctx)}</blockquote>`;

    case "codeBlock": {
      const language = normalizeLanguage(node.attrs?.language);
      const rawText = extractRawText(node);
      const highlighted = highlightCode(rawText, language);
      const langClass = language ? ` class="language-${language} hljs"` : ` class="hljs"`;
      return `<pre><code${langClass}>${highlighted}</code></pre>`;
    }

    case "horizontalRule":
      return `<hr />`;

    case "hardBreak":
      return `<br />`;

    case "text":
      return renderText(node);

    // El validador rechaza docs con `image` en 019; si por alguna razón llega
    // acá, se omite en silencio en vez de emitir un `<img>` sin políticas de
    // sanitización aún definidas.
    case "image":
      return "";

    // 022: chip inline "@Nombre" sin link clickeable en el MVP.
    // data-mention-user-id queda por si una fase futura lo consume (tooltip
    // con card del usuario, click a /admin/users/[id]).
    case "mention": {
      const userId = typeof node.attrs?.user_id === "string" ? node.attrs.user_id : "";
      const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
      return `<span class="inline-flex items-baseline rounded bg-brand-50 px-1 text-brand-800" data-mention-user-id="${escapeAttr(userId)}">@${escapeText(label)}</span>`;
    }

    default:
      return "";
  }
}

function renderText(node: ProseMirrorNode): string {
  const text = escapeText(node.text ?? "");
  const marks = node.marks ?? [];
  return applyMarks(text, marks);
}

function applyMarks(text: string, marks: ProseMirrorMark[]): string {
  // Se aplican en orden inverso al array — es la convención de ProseMirror
  // para que la primera mark del array quede como el envoltorio más interno.
  let result = text;
  for (let i = marks.length - 1; i >= 0; i--) {
    result = wrapMark(result, marks[i]!);
  }
  return result;
}

function wrapMark(inner: string, mark: ProseMirrorMark): string {
  switch (mark.type) {
    case "bold":
      return `<strong>${inner}</strong>`;
    case "italic":
      return `<em>${inner}</em>`;
    case "code":
      return `<code>${inner}</code>`;
    case "link": {
      const rawHref = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
      const safeHref = sanitizeHref(rawHref);
      if (!safeHref) return inner;
      return `<a href="${escapeAttr(safeHref)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }
    default:
      return inner;
  }
}

function sanitizeHref(href: string): string | null {
  // Defensa en profundidad — el validador ya rechazó protocolos fuera de la
  // whitelist. Si llegó acá con un scheme raro, se descarta el link entero
  // pero se conserva el texto (`wrapMark` devuelve `inner` sin envolver).
  const match = /^([a-z][a-z0-9+\-.]*):/i.exec(href);
  if (!match) return null;
  const protocol = match[1]!.toLowerCase();
  const allowed = LINK_PROTOCOLS as readonly string[];
  return allowed.includes(protocol) ? href : null;
}

function normalizeLanguage(value: unknown): CodeBlockLanguage | null {
  if (typeof value !== "string") return null;
  const allowed = CODE_BLOCK_LANGUAGES as readonly string[];
  return allowed.includes(value) ? (value as CodeBlockLanguage) : null;
}

function extractRawText(node: ProseMirrorNode): string {
  // Un `codeBlock` solo tiene nodos `text` (sin marks aplicadas visualmente —
  // el resaltado lo pone lowlight). Concateno el `text` de cada hijo directo.
  if (!node.content) return "";
  return node.content
    .map((child) => (child.type === "text" ? (child.text ?? "") : ""))
    .join("");
}

function highlightCode(code: string, language: CodeBlockLanguage | null): string {
  if (!code) return "";
  if (!language || language === "plaintext") {
    return escapeText(code);
  }
  try {
    const tree = lowlight.highlight(language, code);
    return toHtml(tree);
  } catch {
    // Si lowlight no conoce el language por alguna razón, cae al escape simple.
    // No queremos que un code block roto tire toda la renderización del ticket.
    return escapeText(code);
  }
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
