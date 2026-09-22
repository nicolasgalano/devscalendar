// Config de `@tiptap/suggestion` para el popover del @ mention.
// Consumido por `buildRichTextExtensions({ mentionSuggestion })` y por ende
// por `<RichTextEditor projectId={...} />`.
//
// Dos piezas:
//   - `items({ query })` — fetch al endpoint dedicado de miembros (Phase 3
//     de 022). Filtro `ilike '%q%'` sobre nombre/email, cap de 8 (§4.1 del plan).
//     Devuelve `[{ id, full_name, avatar_url }]`.
//   - `render()` — monta el `<MentionList>` (client component) adentro de un
//     popover posicionado con Tiptap-Suggestion. Se rehace por cada key event
//     para forwardear teclado (arrows, Enter, Escape).

"use client";

import type { SuggestionOptions } from "@tiptap/suggestion";

export type MentionSuggestionItem = {
  id: string;
  full_name: string;
  avatar_url: string | null;
};

export function createMentionSuggestion(
  projectId: string,
): Omit<SuggestionOptions<MentionSuggestionItem>, "editor"> {
  return {
    // Char default es "@" — se explicita para claridad.
    char: "@",
    // El popover se dispara adentro de párrafos y de otros bloques inline.
    // Sin allowSpaces, cuando el user tipea "@Juan " (con espacio) se cierra —
    // es lo que Slack/Linear hacen (el espacio confirma que terminó el @).
    allowSpaces: false,

    items: async ({ query }): Promise<MentionSuggestionItem[]> => {
      // Sin AbortController — el uso previo con WeakMap<this, ...> era
      // frágil (el `this` context de tiptap-suggestion no es estable) y
      // el request se completa en ~50 ms. Last-write-wins es suficiente.
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/members?q=${encodeURIComponent(query)}`,
          { credentials: "same-origin" },
        );
        if (!res.ok) {
          console.error("mention members endpoint failed", res.status);
          return [];
        }
        return (await res.json()) as MentionSuggestionItem[];
      } catch (err) {
        console.error("mention members fetch error", err);
        return [];
      }
    },

    // Render se resuelve en un archivo aparte para no arrastrar React/tippy
    // en este módulo (imposible import cíclico con RichTextEditor).
    render: () => {
      // Lazy import — el popover solo se monta cuando el user tipea "@".
      // El primer render carga MentionList; los siguientes lo reusan.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let cleanup: (() => void) | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let updater: ((props: any) => void) | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let keyHandler: ((props: any) => boolean) | null = null;

      return {
        onStart: async (props) => {
          const { mountMentionPopover } = await import("@/components/tickets/mention-popover-host");
          const handle = mountMentionPopover(props);
          cleanup = handle.destroy;
          updater = handle.update;
          keyHandler = handle.onKeyDown;
        },
        onUpdate: (props) => {
          updater?.(props);
        },
        onKeyDown: (props) => {
          return keyHandler?.(props) ?? false;
        },
        onExit: () => {
          cleanup?.();
          cleanup = null;
          updater = null;
          keyHandler = null;
        },
      };
    },
  };
}
