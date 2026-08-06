"use client";

import { createContext, useContext, useTransition, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type PendingContext = {
  pending: boolean;
  /** Runs a navigation, keeping the whole pane in a pending state until it lands. */
  navigate: (run: () => void) => void;
};

const Context = createContext<PendingContext | null>(null);

/**
 * Shares one transition between the filters and the results they affect.
 *
 * Filtering re-renders a Server Component, which takes a round trip. Without a
 * shared pending state the select closes and nothing on screen changes until
 * the new HTML arrives — the user cannot tell whether the click registered.
 *
 * The provider is a Client Component but the views stay on the server: they
 * come through as `children`.
 */
export function CalendarPendingProvider({ children }: { children: ReactNode }) {
  const [pending, startTransition] = useTransition();

  return (
    <Context.Provider
      value={{ pending, navigate: (run) => startTransition(() => run()) }}
    >
      {children}
    </Context.Provider>
  );
}

export function useCalendarPending(): PendingContext {
  const context = useContext(Context);
  if (!context) {
    throw new Error("useCalendarPending necesita estar dentro de CalendarPendingProvider");
  }
  return context;
}

/**
 * Dims the results while a filter change is in flight and announces it.
 *
 * `aria-busy` plus a polite live region: the visual cue alone leaves out anyone
 * using a screen reader (DESIGN.md §12). The old content stays on screen
 * instead of being replaced by a skeleton — keeping the previous answer visible
 * while the next one loads reads as faster than blanking the grid.
 */
export function CalendarResults({ children }: { children: ReactNode }) {
  const { pending } = useCalendarPending();

  return (
    <div aria-busy={pending} className="relative">
      <span aria-live="polite" className="sr-only">
        {pending ? "Actualizando el calendario…" : ""}
      </span>
      <div
        className={cn(
          "transition-opacity",
          pending && "pointer-events-none opacity-50",
        )}
      >
        {children}
      </div>
    </div>
  );
}
