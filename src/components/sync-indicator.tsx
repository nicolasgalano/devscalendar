"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Indicador de sincronización flotante — fixed bottom-right, para trabajo
 * asíncrono en background que le importa al usuario ver.
 *
 * **Uso:**
 *
 *   const { start } = useSyncIndicator();
 *   const stop = start("Guardando cambio");
 *   fetch(...)
 *     .then(...)
 *     .finally(() => stop());
 *
 * `start` devuelve una función `stop`; la referencia mantiene un contador
 * interno de "syncs pendientes", así que dos operaciones simultáneas cada
 * una con su `stop` cuentan como dos entradas y el indicador se apaga
 * cuando ambas terminan. Es el patrón de "in-flight requests" que resiste
 * concurrencia sin lógica extra.
 *
 * **Diseño (DESIGN.md):**
 * - `fixed bottom-6 right-6` — 24px de las esquinas, la escala de spacing.
 * - Pill de 32px de alto (misma altura que un botón chico), radio 6px.
 * - Sombra permitida (§2): es un elemento flotante — misma excepción que
 *   popovers, dialogs y toasts.
 * - Animación de entrada 180ms con `cubic-bezier(0.2,0,0,1)` (§10) y
 *   `motion-reduce:transition-none` para respetar la preferencia del OS.
 * - `role="status"` + `aria-live="polite"` para screen readers.
 * - El spinner usa `motion-reduce:animate-none` — sin animación cuando la
 *   preferencia lo pide.
 */

type SyncEntry = { id: number; label: string };

type SyncContextValue = {
  /** Registra un trabajo en curso. Devuelve la función que lo termina. */
  start: (label?: string) => () => void;
};

const SyncContext = createContext<SyncContextValue | null>(null);

const DEFAULT_LABEL = "Sincronizando";

export function SyncIndicatorProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<SyncEntry[]>([]);
  const nextIdRef = useRef(1);

  const start = useCallback((label: string = DEFAULT_LABEL): (() => void) => {
    const id = nextIdRef.current++;
    setEntries((prev) => [...prev, { id, label }]);
    // La `stop` es idempotente: llamarla dos veces no rompe nada — la
    // segunda no encuentra el id y filter la ignora.
    return () => {
      setEntries((prev) => prev.filter((entry) => entry.id !== id));
    };
  }, []);

  // Mostrar el label de la última operación iniciada — cuando hay varias en
  // vuelo simultáneas, la más reciente es la más relevante para "qué está
  // pasando ahora mismo".
  const currentLabel = entries.at(-1)?.label ?? DEFAULT_LABEL;
  const visible = entries.length > 0;

  return (
    <SyncContext.Provider value={{ start }}>
      {children}
      <SyncIndicator visible={visible} label={currentLabel} />
    </SyncContext.Provider>
  );
}

export function useSyncIndicator(): SyncContextValue {
  const value = useContext(SyncContext);
  if (!value) {
    throw new Error("useSyncIndicator debe usarse adentro de <SyncIndicatorProvider>");
  }
  return value;
}

function SyncIndicator({ visible, label }: { visible: boolean; label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      // `aria-hidden` cuando no es visible: sin esto, un screen reader
      // podría anunciar el label vacío en el load inicial.
      aria-hidden={!visible}
      className={cn(
        "fixed right-6 bottom-6 z-40",
        "border-border bg-background flex items-center gap-2",
        "text-caption text-secondary-foreground rounded-md border px-3 py-1.5",
        "shadow-md",
        "duration-[180ms] transition-[opacity,transform] ease-[cubic-bezier(0.2,0,0,1)]",
        "motion-reduce:transition-none",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      <Loader2Icon
        aria-hidden="true"
        className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
      />
      <span>{label}…</span>
    </div>
  );
}
