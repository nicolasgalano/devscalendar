"use client";

// Popover del @ mention. Client component montado imperativamente por
// `mount-mention-popover.ts` cuando Tiptap Suggestion dispara `onStart`.
//
// Exponemos handle imperativo (`onKeyDown(event) => boolean`) para que el
// suggestion forwardee arrows/Enter — sin esto la lista es solo click-select,
// que rompe el flujo de teclado esperado.

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import type { MentionSuggestionItem } from "@/lib/editor/mention-suggestion";

export type MentionListHandle = {
  onKeyDown: (event: KeyboardEvent) => boolean;
};

type MentionListProps = {
  items: MentionSuggestionItem[];
  command: (item: MentionSuggestionItem) => void;
};

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  function MentionList({ items, command }, ref) {
    const [activeIndex, setActiveIndex] = useState(0);

    // Reset del cursor cuando cambia la lista (el usuario tipeó más y
    // el resultado se refiltró) — sin esto activeIndex puede quedar
    // apuntando a un índice que ya no existe.
    useEffect(() => {
      setActiveIndex(0);
    }, [items]);

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: (event: KeyboardEvent) => {
          if (items.length === 0) return false;
          if (event.key === "ArrowDown") {
            setActiveIndex((i) => (i + 1) % items.length);
            return true;
          }
          if (event.key === "ArrowUp") {
            setActiveIndex((i) => (i - 1 + items.length) % items.length);
            return true;
          }
          if (event.key === "Enter") {
            const item = items[activeIndex];
            if (item) command(item);
            return true;
          }
          return false;
        },
      }),
      [activeIndex, items, command],
    );

    const select = (idx: number) => {
      const item = items[idx];
      if (item) command(item);
    };

    return (
      <div
        role="listbox"
        aria-label="Miembros del proyecto"
        className="w-64 max-h-72 overflow-y-auto rounded-md border border-subtle bg-surface shadow-md py-1"
      >
        {items.length === 0 ? (
          <div className="px-3 py-2 text-subtle text-sm">Sin miembros que matcheen</div>
        ) : (
          items.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={idx === activeIndex}
              onClick={() => select(idx)}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                idx === activeIndex ? "bg-muted text-emphasis" : "hover:bg-muted"
              }`}
            >
              {item.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.avatar_url}
                  alt=""
                  className="size-6 rounded-full object-cover"
                  aria-hidden="true"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex size-6 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-xs font-medium"
                >
                  {item.full_name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <span className="truncate">{item.full_name}</span>
            </button>
          ))
        )}
      </div>
    );
  },
);
