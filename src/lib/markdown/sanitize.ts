import { defaultSchema, type Options as Schema } from "rehype-sanitize";

/**
 * Schema de sanitizado para las descripciones de tickets.
 *
 * Es una **whitelist explícita** sobre `defaultSchema` de rehype-sanitize:
 * lo que no está listado se descarta silenciosamente al renderizar. No es
 * defensa en profundidad — es la única defensa contra HTML malicioso, porque
 * `description` guarda markdown crudo (columna `text` en la migration 14) y
 * el sanitizado se hace al leer, no al escribir (plan.md §3.4).
 *
 * Qué se admite y por qué:
 *   - Estructura: párrafos, saltos, headings h1–h4 (los h5/h6 no aportan a la
 *     descripción de un ticket).
 *   - Énfasis: strong, em, del, code inline.
 *   - Bloques: pre + code (sin resaltado de sintaxis).
 *   - Listas: ul/ol/li, con task lists de gfm (`- [x]`).
 *   - Blockquotes.
 *   - Links: `<a href>` sanitizados a los tres schemes seguros, con
 *     `target="_blank" rel="noopener noreferrer"` forzados vía `defaults`.
 *   - Tablas de gfm (table/thead/tbody/tr/th/td) — para "columna/valor".
 *
 * Qué se excluye a propósito:
 *   - Imágenes (`<img>`): descripciones no las necesitan y meterlas abre la
 *     puerta a `data:` URIs, tracking pixels vía `src`, etc. Attachments es
 *     fase 2 según spec §5.
 *   - Iframes, embeds, objects, media.
 *   - `<html>` crudo (react-markdown lo desactiva por default; se refuerza
 *     acá excluyéndolo de `tagNames`).
 *   - Atributos `style`, `class`, `id`, `on*` — el CSS del sitio manda.
 *   - Schemes distintos a http/https/mailto en `href`.
 */
export const markdownSanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: [
    "p",
    "br",
    "h1",
    "h2",
    "h3",
    "h4",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "ul",
    "ol",
    "li",
    "input", // Solo `<input type="checkbox">` para task lists — se acota abajo.
    "blockquote",
    "a",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  attributes: {
    // `defaultSchema` ya limita `href` a schemes seguros (`protocols`), pero la
    // whitelist explícita evita que `title` y otros atributos sospechosos
    // pasen.
    a: ["href"],
    input: [
      // Solo checkboxes de task lists — el gfm los inserta con `checked`
      // (bool) y `disabled` (bool). Nada de otros tipos.
      ["type", "checkbox"],
      "checked",
      "disabled",
    ],
    // Tablas de gfm: alineación en `th`/`td` como atributo `align`.
    th: ["align"],
    td: ["align"],
    // Code fences de gfm ponen `className="language-xx"` en `<code>`.
    // Se deja pasar para que un highlighter futuro lo pueda leer; no lo
    // usamos hoy.
    code: [["className", /^language-/]],
  },
  protocols: {
    href: ["http", "https", "mailto"],
  },
  clobberPrefix: "user-content-",
  strip: ["script", "style"],
};
