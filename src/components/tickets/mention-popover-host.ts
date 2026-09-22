// Host imperativo del popover de @ mention. Lo invoca
// `createMentionSuggestion` (Tiptap Suggestion) en `onStart` para montar
// el `<MentionList>` React adentro de un div fixed-positioned.
//
// Sin tippy.js (Tiptap 3.x lo sacó como dep). Cálculo de posición manual
// desde `props.clientRect()` — devuelve el DOMRect del caret. Posicionamos
// el popover justo debajo (o arriba si no cabe) con `position: fixed`.
//
// El popover forwardea flechas/Enter/Escape al `<MentionList>` via handle
// imperativo — MentionList expone `onKeyDown(event) => boolean` que devuelve
// true si consumió la tecla.

"use client";

import { ReactRenderer } from "@tiptap/react";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";

import { MentionList, type MentionListHandle } from "./mention-list";
import type { MentionSuggestionItem } from "@/lib/editor/mention-suggestion";

type Handle = {
  update: (props: SuggestionProps<MentionSuggestionItem>) => void;
  destroy: () => void;
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

export function mountMentionPopover(
  props: SuggestionProps<MentionSuggestionItem>,
): Handle {
  // Container fixed en el body; se destruye al onExit.
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.zIndex = "50";
  document.body.appendChild(container);

  const renderer = new ReactRenderer<MentionListHandle, {
    items: MentionSuggestionItem[];
    command: (item: MentionSuggestionItem) => void;
  }>(MentionList, {
    props: {
      items: props.items,
      command: (item: MentionSuggestionItem) => props.command({ user_id: item.id, label: item.full_name } as never),
    },
    editor: props.editor,
  });

  container.appendChild(renderer.element as Node);

  const position = () => {
    const rect = props.clientRect?.();
    if (!rect) return;
    // Debajo del caret; si no cabe, arriba.
    const spaceBelow = window.innerHeight - rect.bottom;
    const popoverHeight = container.offsetHeight || 200;
    const top =
      spaceBelow >= popoverHeight + 8 ? rect.bottom + 4 : Math.max(8, rect.top - popoverHeight - 4);
    container.style.top = `${top}px`;
    container.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
  };
  position();

  const onResize = () => position();
  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onResize, true);

  return {
    update(newProps) {
      renderer.updateProps({
        items: newProps.items,
        command: (item: MentionSuggestionItem) => newProps.command({ user_id: item.id, label: item.full_name } as never),
      });
      position();
    },
    destroy() {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      renderer.destroy();
      container.remove();
    },
    onKeyDown(keyProps) {
      // Escape cierra siempre.
      if (keyProps.event.key === "Escape") {
        return true;
      }
      return renderer.ref?.onKeyDown(keyProps.event) ?? false;
    },
  };
}
