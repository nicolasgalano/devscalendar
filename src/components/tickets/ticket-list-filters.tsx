"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListFilterIcon, Loader2Icon, SearchIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_ORDER,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_OPEN,
  TICKET_STATUS_ORDER,
} from "@/lib/tickets/status";
import {
  buildTicketsHref,
  clearTicketFiltersHref,
  hasActiveTicketFilters,
  type TicketFilters,
  type TicketFiltersPatch,
} from "@/lib/tickets/url";
import type { Database } from "@/types/database";

const ALL = "__all__";

type TicketStatus = Database["public"]["Enums"]["ticket_status"];
type TicketPriority = Database["public"]["Enums"]["ticket_priority"];

export type FilterProjectOption = { id: string; name: string; key: string };
export type FilterAssigneeOption = { id: string; name: string };

/**
 * Filtros del listado. Igual patrón que `CalendarFilters` (`003`/`014`): el
 * estado vive en la URL, no en React. Cada cambio navega a un href construido
 * por `buildTicketsHref`, y `useOptimistic` refleja la elección hasta que el
 * server rerenderea. Nada de estado dividido — un filtro es lo que dice la URL.
 *
 * La search box es la única que no navega en cada tecla: dispara al `blur` o
 * al `Enter`. Sin eso, cada letra provoca un round trip a la RLS.
 */
export function TicketListFilters({
  filters,
  projects,
  assignees,
  basePath,
  hideProjectFilter = false,
}: {
  filters: TicketFilters;
  projects: FilterProjectOption[];
  assignees: FilterAssigneeOption[];
  /** Path base para construir los href — `/my-work` o `/projects/[key]/backlog`. */
  basePath?: string;
  /** Cuando el listado ya está scoped por proyecto (backlog), el select de
   *  proyecto es redundante y se esconde. */
  hideProjectFilter?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(filters);

  const [searchDraft, setSearchDraft] = useState(filters.q ?? "");

  function apply(patch: TicketFiltersPatch) {
    const href = buildTicketsHref(optimistic, patch, basePath);
    startTransition(() => {
      setOptimistic({ ...optimistic, ...patch });
      // `replace`: cambiar seis veces un filtro no tiene por qué dejar seis
      // entradas en el back stack (mismo criterio que el calendario).
      router.replace(href);
    });
  }

  function applySearch() {
    const value = searchDraft.trim();
    apply({ q: value.length > 0 ? value : null });
  }

  const active = hasActiveTicketFilters(optimistic);

  return (
    <div className="flex flex-col gap-2 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        {!hideProjectFilter && (
          <FilterSelect
            label="Proyecto"
            value={optimistic.projectId}
            options={projects.map((project) => ({ id: project.id, name: project.name }))}
            onSelect={(value) => apply({ projectId: value })}
          />
        )}

        <MultiCheckDropdown
          label="Estado"
          count={optimistic.statuses.length}
          isDefault={sameSet(optimistic.statuses, TICKET_STATUS_OPEN)}
          options={TICKET_STATUS_ORDER.map((status) => ({
            id: status,
            label: TICKET_STATUS_LABELS[status],
            checked: optimistic.statuses.includes(status),
          }))}
          onToggle={(status) =>
            apply({
              statuses: toggleStatus(optimistic.statuses, status as TicketStatus),
              // Toggling a status manually invalidates the "todos" shortcut.
              includeClosed: false,
            })
          }
        />

        <FilterSelect
          label="Asignado"
          value={optimistic.assigneeId}
          options={[
            { id: "me", name: "Míos" },
            { id: "unassigned", name: "Sin asignar" },
            ...assignees.map((person) => ({ id: person.id, name: person.name })),
          ]}
          onSelect={(value) => apply({ assigneeId: value })}
        />

        <MultiCheckDropdown
          label="Prioridad"
          count={optimistic.priorities.length}
          isDefault={optimistic.priorities.length === 0}
          options={TICKET_PRIORITY_ORDER.map((priority) => ({
            id: priority,
            label: TICKET_PRIORITY_LABELS[priority],
            checked: optimistic.priorities.includes(priority),
          }))}
          onToggle={(priority) =>
            apply({ priorities: togglePriority(optimistic.priorities, priority as TicketPriority) })
          }
        />

        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
          />
          <Input
            aria-label="Buscar por título"
            placeholder="Buscar…"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onBlur={applySearch}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applySearch();
              }
            }}
            className="h-8 w-44 pl-7"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          aria-pressed={optimistic.includeClosed}
          onClick={() =>
            apply({
              includeClosed: !optimistic.includeClosed,
              // Al pisar el toggle, se reinicia el listado de status para que
              // no quede un "manual" tapando el shortcut (mismo criterio del
              // shortcut del calendario).
              statuses: optimistic.includeClosed
                ? [...TICKET_STATUS_OPEN]
                : [...TICKET_STATUS_ORDER],
            })
          }
        >
          <Checkbox checked={optimistic.includeClosed} tabIndex={-1} aria-hidden="true" />
          Incluir cerrados
        </Button>

        {pending && (
          <span className="text-caption text-muted-foreground flex items-center gap-1.5">
            <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin" />
            Actualizando…
          </span>
        )}
      </div>

      {active && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              startTransition(() => {
                setSearchDraft("");
                router.replace(clearTicketFiltersHref(basePath));
              })
            }
          >
            <XIcon aria-hidden="true" />
            Limpiar filtros
          </Button>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string | null;
  options: { id: string; name: string }[];
  onSelect: (value: string | null) => void;
}) {
  const selected = options.find((option) => option.id === value);
  const empty = options.length === 0;

  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onSelect(next === ALL ? null : (next as string))}
      disabled={empty && !selected}
    >
      <SelectTrigger size="sm" className="w-auto min-w-36" aria-label={label}>
        <SelectValue>
          {selected ? (
            <span>
              <span className="text-muted-foreground">{label}: </span>
              {selected.name}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {empty ? `${label}: sin opciones` : label}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        <SelectItem value={ALL}>Todos</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MultiCheckDropdown({
  label,
  count,
  isDefault,
  options,
  onToggle,
}: {
  label: string;
  count: number;
  isDefault: boolean;
  options: { id: string; label: string; checked: boolean }[];
  onToggle: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <ListFilterIcon aria-hidden="true" />
        {label}
        {!isDefault && count > 0 && (
          <Badge variant="secondary" className="font-data">
            {count}
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            closeOnClick={false}
            onClick={() => onToggle(option.id)}
          >
            <Checkbox checked={option.checked} tabIndex={-1} aria-hidden="true" />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function toggleStatus(current: TicketStatus[], status: TicketStatus): TicketStatus[] {
  const next = current.includes(status)
    ? current.filter((entry) => entry !== status)
    : [...current, status];
  // Sin ninguno seleccionado, el listado queda vacío sin explicación posible;
  // devolvemos al default (los cuatro abiertos), mismo criterio que el
  // calendario.
  return next.length > 0 ? next : [...TICKET_STATUS_OPEN];
}

function togglePriority(
  current: TicketPriority[],
  priority: TicketPriority,
): TicketPriority[] {
  return current.includes(priority)
    ? current.filter((entry) => entry !== priority)
    : [...current, priority];
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((entry) => b.includes(entry));
}
