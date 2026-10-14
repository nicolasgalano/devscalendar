"use client";

import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { filterItems, type SearchableItem } from "./searchable-selector-filter";

// 027. Selector tipo combobox usado por el `<TimeEntryDialog>` para proyecto y
// ticket — listas que pueden crecer (10+ proyectos activos, 100+ tickets por
// proyecto grande). Reemplaza al `<SelectorRow>` (que seguía siendo un
// `<Select>` plano) manteniendo la misma pinta visual: icono `+` a la
// izquierda y texto del valor seleccionado.
//
// Decisión del plan de 027: implementación mínima sin `cmdk` — Popover + Input
// + lista filtrada con `useMemo`. Si en el futuro aparece la necesidad de
// highlighting o virtualización para listas enormes, se migra a `cmdk`.
//
// El filtro vive en `searchable-selector-filter.ts` (archivo .ts aparte) para
// que los unit tests lo importen sin que vite tenga que procesar JSX.

export type { SearchableItem };

type Props = {
  items: readonly SearchableItem[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  // Cuando `true`, aparece un botón X dentro del trigger (visible solo si
  // hay valor seleccionado) para resetear a null. Útil para campos opcionales
  // como el ticket del `<TimeEntryDialog>`.
  clearable?: boolean;
};

export function SearchableSelector({
  items,
  value,
  onChange,
  placeholder,
  searchPlaceholder = "Buscar…",
  emptyMessage = "No se encontraron resultados",
  disabled,
  clearable = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => (value ? items.find((it) => it.id === value) ?? null : null),
    [items, value],
  );

  const filtered = useMemo(() => filterItems(items, query), [items, query]);

  // Reset el filtro cada vez que se cierra el popover para que el próximo
  // open arranque limpio (AC-1.5 del spec).
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Autofocus del input al abrir (AC-1.4). El Popover de BaseUI mueve foco
  // al Popup; nosotros lo redirigimos al Input.
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const display = selected?.label ?? placeholder;
  const hasSelection = selected !== null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        className={cn(
          "border-input bg-background text-foreground flex w-full items-center justify-start gap-2 rounded-md border px-3 py-2 text-ui outline-none",
          "focus-visible:outline-ring focus-visible:outline-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <PlusIcon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            hasSelection ? "text-muted-foreground" : "text-primary",
          )}
        />
        <span className={cn("truncate text-left", !hasSelection && "text-muted-foreground")}>
          {display}
        </span>
        {clearable && hasSelection && !disabled && (
          <span
            role="button"
            aria-label="Limpiar selección"
            tabIndex={0}
            onPointerDown={(e) => {
              // Interceptamos antes de que el trigger reciba el click que
              // abriría el popover. `onClick` llega después del trigger
              // y el popover queda abierto, cosa que no queremos.
              e.stopPropagation();
              e.preventDefault();
              onChange(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                onChange(null);
              }
            }}
            className="text-muted-foreground hover:text-foreground ml-auto flex size-5 shrink-0 items-center justify-center rounded-md"
          >
            <XIcon aria-hidden="true" className="size-3.5" />
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[--popover-width] min-w-[260px] max-w-[400px] p-0"
      >
        <div className="border-border border-b p-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            autoComplete="off"
            className="h-8"
          />
        </div>

        <ul role="listbox" className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <li className="text-caption text-muted-foreground px-2 py-3 text-center">
              {emptyMessage}
            </li>
          ) : (
            filtered.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.id === value}
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui outline-none",
                    item.id === value && "bg-muted",
                  )}
                >
                  <CheckIcon
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0",
                      item.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {item.meta && (
                    <span className="font-data text-muted-foreground shrink-0 text-caption">
                      {item.meta}
                    </span>
                  )}
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

