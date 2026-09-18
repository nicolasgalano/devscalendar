import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { StarterKit } from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";

import { CODE_BLOCK_LANGUAGES, LINK_PROTOCOLS } from "./schema";

// Config de extensiones que consume el `<RichTextEditor>`. Traduce
// `RICH_TEXT_SCHEMA` a la config real de Tiptap. Cada decisión acá tiene que
// mantenerse alineada con `schema.ts` — si un nodo cambia allá y no acá, el
// editor deja pasar cosas que el validador después rebota (mala UX) o el
// editor bloquea cosas que el validador aceptaría (peor UX).
//
// Cliente-side por defecto: `lowlight` acá también, pero la instancia es
// distinta de la del server-renderer (`render.ts`). No compartimos porque
// cada uno usa un bundle distinto (server: `lowlight/lib/common` directo;
// cliente: la misma instancia dentro del bundle que Tiptap sube al browser).

const lowlight = createLowlight(common);

type BuildOptions = {
  placeholder?: string;
};

export function buildRichTextExtensions({ placeholder }: BuildOptions = {}) {
  return [
    StarterKit.configure({
      // heading queda restringido a los tres niveles del schema; H4+ no
      // aparecen ni por atajo ni por markdown shortcut ni por paste.
      heading: { levels: [1, 2, 3] },
      // El codeBlock del StarterKit no hace resaltado; se reemplaza por
      // CodeBlockLowlight abajo. Desactivarlo evita dos nodos codeBlock
      // registrados a la vez.
      codeBlock: false,
      // Link viene del StarterKit por defecto — se desactiva y se agrega
      // Link.configure() aparte para poder pasar `protocols`, `openOnClick`
      // y compañía, que la config default no expone.
      link: false,
      // Underline no está en RICH_TEXT_SCHEMA — se apaga.
      underline: false,
      // Strike (tachado) no está en el schema — se apaga.
      strike: false,
    }),

    CodeBlockLowlight.configure({
      lowlight,
      // El default por si el usuario escribe ```code sin especificar language.
      // Cae en `plaintext` que es válido en el schema.
      defaultLanguage: "plaintext",
      // Nota: la lista completa se usa arriba, `lowlight` ya trae los grammars
      // de `common` (~35 languages). Nuestro whitelist (CODE_BLOCK_LANGUAGES)
      // es un subset — el validador rechaza cualquier language fuera de ahí.
      // Esta constante existe solo para dejar rastro de que el subset se
      // eligió a propósito y no es "todo lo que lowlight sepa".
      // Los languages tolerados por el editor son:
      //   ${JSON.stringify(CODE_BLOCK_LANGUAGES)}
    }),

    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      protocols: [...LINK_PROTOCOLS],
      // Sin `HTMLAttributes`: la extensión usaría esos valores como default de
      // los attrs `target`, `rel`, `class` del mark (los emitiría en el JSON
      // como strings reales, no null), y el validador Zod los rebota porque
      // no están declarados en `RICH_TEXT_SCHEMA`. El `target="_blank"
      // rel="noopener noreferrer"` los mete `renderDocToHtml` hardcodeados en
      // el viewer server-side, así que perder el default acá no cambia lo que
      // ve el usuario, y sí evita ensuciar el doc guardado con "ghost data".
    }),

    TaskList,
    TaskItem.configure({
      // Los taskItems del schema son planos — no nesteados. Nested task lists
      // complican el `data-task-index` del render y la hidratación.
      nested: false,
    }),

    // Declarado sin toolbar ni paste handler — el `<RichTextEditor>` de 019
    // no expone un botón "insertar imagen". El paste sanitizer descarta las
    // imágenes pegadas. `020` va a activar todo esto. Se lo mantiene en la
    // lista para que `Tiptap.generateHTML(doc, extensions)` en tests futuros
    // no rompa si aparece un nodo `image` en algún fixture.
    Image,

    Placeholder.configure({
      placeholder: placeholder ?? "Escribí una descripción para el ticket…",
    }),
  ];
}

// Nombre exportado por si algún consumidor futuro (paste sanitizer, tests)
// necesita la lista sin placeholder específico.
export const richTextExtensions = buildRichTextExtensions();

// Re-exportado para conveniencia — los mismos languages que consume el
// renderer server-side (`render.ts`). El validador ya rechaza otros valores,
// pero el editor podría mostrar una UI con esta lista como opciones.
export { CODE_BLOCK_LANGUAGES };
