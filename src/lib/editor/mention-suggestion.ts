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

const ABORT_ON_UNMOUNT = new WeakMap<object, AbortController>();

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

    async items({ query }): Promise<MentionSuggestionItem[]> {
      // Abort in-flight: si el user tipea rápido, cancelo el fetch previo.
      // Sin esto el request más lento puede volver después y pisar el
      // resultado bueno.
      const prev = ABORT_ON_UNMOUNT.get(this as unknown as object);
      if (prev) prev.abort();
      const ctrl = new AbortController();
      ABORT_ON_UNMOUNT.set(this as unknown as object, ctrl);

      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/members?q=${encodeURIComponent(query)}`,
          { credentials: "same-origin", signal: ctrl.signal },
        );
        if (!res.ok) return [];
        return (await res.json()) as MentionSuggestionItem[];
      } catch (err) {
        if ((err as Error).name === "AbortError") return [];
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
