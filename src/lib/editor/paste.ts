import { LINK_PROTOCOLS } from "./schema";

// Sanitizer del HTML pegado al editor. Se cablea en `EditorProps
// .transformPastedHTML` desde el `<RichTextEditor>` — Tiptap llama a esto
// antes de re-parsear el HTML contra el schema del editor.
//
// Filosofía: **whitelist estricta de tags y de atributos.** Cualquier tag
// que no matchea el schema del §3.1 se _unwrappea_ (se reemplaza por sus
// hijos, para no perder el texto que había adentro) o se _descarta entero_
// (cuando el contenido sería peligroso: script, style, iframe). Los tags
// permitidos conservan sólo los atributos que la whitelist lista.
//
// Cliente-only: usa `DOMParser` (no existe en Node). No importarlo en
// código server-side — el editor entero es dynamic() con ssr:false, así
// que no pasa nunca.

// Tags que se conservan tal cual (sin atributos, salvo los que la whitelist
// de más abajo permita para ese tag específico).
const ALLOWED_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "CODE",
  "HR",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "A",
  "DIV",
  "SPAN",
]);

// Tags que se descartan **enteros** (con todo su contenido). Un `<script>` o
// `<style>` que llega pegado no queremos ni el texto adentro.
const DISCARD_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "NOSCRIPT",
  "OBJECT",
  "EMBED",
  "APPLET",
  "IMG", // el nodo image se activa en 020; en 019 se descarta el img entero
  "SVG",
  "VIDEO",
  "AUDIO",
  "CANVAS",
  "META",
  "LINK",
  "HEAD",
  "TITLE",
  "FORM",
  "INPUT",
  "BUTTON",
  "SELECT",
  "TEXTAREA",
]);

// Headings mayores a H3 se _unwrappean_ — su texto sobrevive pero pierden la
// jerarquía (Notion, Google Docs, etc. exportan H4/H5).
const UNWRAP_TAGS = new Set(["H4", "H5", "H6"]);

// Atributos que se conservan por tag. Los tags no listados acá pierden todos
// sus atributos.
const ATTR_WHITELIST: Record<string, Set<string>> = {
  A: new Set(["href"]),
  OL: new Set(["start"]),
  UL: new Set(["data-task-list"]),
  LI: new Set(["data-task-index", "data-checked"]),
};

export function sanitizePastedHtml(html: string): string {
  if (typeof html !== "string" || html.length === 0) return "";
  if (typeof DOMParser === "undefined") {
    // No debería pasar (el editor es client-only), pero devolvemos el string
    // sin tocar si por alguna razón el sanitizer corre server-side.
    return html;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const container = doc.body;
  sanitizeElement(container);
  return container.innerHTML;
}

function sanitizeElement(element: Element): void {
  // Copio la lista de hijos antes de iterar porque vamos a mutarla adentro
  // (remove / replaceWith mueven índices sobre la marcha).
  const children = Array.from(element.children);

  for (const child of children) {
    const tag = child.tagName.toUpperCase();

    if (DISCARD_TAGS.has(tag)) {
      child.remove();
      continue;
    }

    if (UNWRAP_TAGS.has(tag)) {
      // Recurse antes de unwrap para que sus hijos también queden limpios.
      sanitizeElement(child);
      unwrap(child);
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      sanitizeElement(child);
      unwrap(child);
      continue;
    }

    // Tag permitido: limpiar atributos y recursar.
    stripDisallowedAttrs(child, tag);
    sanitizeElement(child);
  }
}

function stripDisallowedAttrs(element: Element, tag: string): void {
  const allowed = ATTR_WHITELIST[tag] ?? new Set<string>();
  const toRemove: string[] = [];

  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    if (!allowed.has(name)) {
      toRemove.push(attr.name);
    }
  }

  for (const name of toRemove) {
    element.removeAttribute(name);
  }

  // Saneo del href: si el protocolo no está en la whitelist, se descarta el
  // link entero (se unwrappea el `<a>` conservando el texto adentro).
  if (tag === "A") {
    const href = element.getAttribute("href");
    if (!href || !hasAllowedProtocol(href)) {
      unwrap(element);
    }
  }
}

function hasAllowedProtocol(href: string): boolean {
  const match = /^([a-z][a-z0-9+\-.]*):/i.exec(href.trim());
  if (!match) return false;
  const protocol = match[1]!.toLowerCase();
  return (LINK_PROTOCOLS as readonly string[]).includes(protocol);
}

function unwrap(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}
