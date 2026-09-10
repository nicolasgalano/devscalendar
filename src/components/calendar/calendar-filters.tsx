"use client";

import { useOptimistic } from "react";
import { useRouter } from "next/navigation";
import { ListFilterIcon, Loader2Icon, XIcon } from "lucide-react";

import { bookingStatusLabel } from "@/components/calendar/booking-status";
import { useCalendarPending } from "@/components/calendar/calendar-pending";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Facets } from "@/lib/calendar/facets";
import { calendarHref, clearFiltersHref } from "@/lib/calendar/url";
import {
  DEFAULT_STATUSES,
  hasActiveFilters,
  type BookingStatus,
  type CalendarFilters as Filters,
  type CalendarParams,
} from "@/lib/validation/calendar";

const ALL = "__all__";
const STATUSES: BookingStatus[] = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "displaced",
];

/**
 * The six combinable filters of AC-4.1 / spec §4.4.
 *
 * State still lives in the URL, not in React: every change navigates to an href
 * built by the same `calendarHref` the toolbar uses, so filters survive
 * navigation, are shareable and work with the back button. The local state here
 * is only optimistic — it shows the choice while the server catches up.
 *
 * The options are **facets of what is on screen** (`deriveFacets`), not the full
 * master data: picking a developer narrows the other selects to the clients and
 * projects that developer actually has bookings on, in this range.
 */
export function CalendarFilters({
  params,
  facets,
  pmOnlyIds,
}: {
  params: CalendarParams;
  facets: Facets;
  /**
   * IDs de profiles con `roles = {pm}` puros — se muestran o esconden con el
   * toggle "Incluir PMs" (feature 014). El componente lo usa para marcar con
   * un badge al PM cuando aparece en el select de desarrollador porque la
   * URL lo trae explícito (AC-3.2).
   */
  pmOnlyIds: readonly string[];
}) {
  const router = useRouter();
  const { pending, navigate } = useCalendarPending();

  // Reflects the click immediately; React discards it when the new server
  // render arrives. Without this the select keeps showing the old value for
  // the whole round trip, because the value is read from the URL.
  const [filters, setOptimistic] = useOptimistic(params.filters);

  function apply(patch: Partial<Filters>) {
    const href = calendarHref(params, { filters: patch });
    navigate(() => {
      setOptimistic({ ...filters, ...patch });
      // `replace`: tweaking a filter five times should not leave five entries
      // in the history to walk back through.
      router.replace(href);
    });
  }

  const active = hasActiveFilters(filters);

  return (
    <div className="flex flex-col gap-2 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Cliente"
          value={filters.clientId}
          options={facets.clients}
          // Changing client invalidates a project from another client.
          onSelect={(value) => apply({ clientId: value, projectId: null })}
        />
        <FilterSelect
          label="Proyecto"
          value={filters.projectId}
          options={facets.projects}
          onSelect={(value) => apply({ projectId: value })}
        />
        <FilterSelect
          label="Desarrollador"
          value={filters.devId}
          options={facets.devs}
          onSelect={(value) => apply({ devId: value })}
          // Cuando el dev seleccionado es PM puro y el toggle está off, la URL
          // "manda" (AC-3.1) pero la persona no aparece en el resto de la
          // vista: el badge deja claro por qué solo se ven sus reservas.
          badgeForId={
            filters.includePms
              ? undefined
              : (id) => (pmOnlyIds.includes(id) ? "PM" : null)
          }
        />
        <FilterSelect
          label="PM"
          value={filters.pmId}
          options={facets.pms}
          onSelect={(value) => apply({ pmId: value })}
        />
        <FilterSelect
          label="Prioridad"
          value={filters.priority}
          options={[
            { id: "high", name: "Prioritario" },
            { id: "normal", name: "Común" },
          ]}
          onSelect={(value) => apply({ priority: value as "high" | "normal" | null })}
        />

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <ListFilterIcon aria-hidden="true" />
            Estado
            {!isDefaultStatuses(filters.statuses) && (
              <span className="font-data">({filters.statuses.length})</span>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {STATUSES.map((status) => (
              <DropdownMenuItem
                key={status}
                closeOnClick={false}
                onClick={() => apply({ statuses: toggleStatus(filters.statuses, status) })}
              >
                <Checkbox
                  checked={filters.statuses.includes(status)}
                  tabIndex={-1}
                  aria-hidden="true"
                />
                {bookingStatusLabel(status)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Feature 014: los PMs puros se esconden por default; este toggle los
            trae de vuelta a la vista y al desplegable de "Desarrollador". */}
        <Button
          variant="outline"
          size="sm"
          aria-pressed={filters.includePms}
          onClick={() => apply({ includePms: !filters.includePms })}
        >
          <Checkbox
            checked={filters.includePms}
            tabIndex={-1}
            aria-hidden="true"
          />
          Incluir PMs
        </Button>

        {pending && (
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin" />
            Actualizando…
          </span>
        )}
      </div>

      {/* Fila propia: como hijo del `flex-wrap` de arriba, el botón cambiaba de
          lugar según cuántos filtros hubiera activos. */}
      {active && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(() => router.replace(clearFiltersHref(params)))}>
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
  badgeForId,
}: {
  label: string;
  value: string | null;
  options: { id: string; name: string }[];
  onSelect: (value: string | null) => void;
  /** Un texto corto para acompañar al nombre seleccionado, o `null` si no. */
  badgeForId?: (id: string) => string | null;
}) {
  const selected = options.find((option) => option.id === value);
  // Nothing to choose from: the range has no bookings to narrow. Saying so is
  // better than an empty dropdown that reads as broken.
  const empty = options.length === 0;
  const selectedBadge = selected && badgeForId ? badgeForId(selected.id) : null;

  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onSelect(next === ALL ? null : (next as string))}
      disabled={empty && !selected}
    >
      <SelectTrigger size="sm" className="w-auto min-w-36" aria-label={label}>
        {/* El valor se resuelve a mano: `SelectValue` sin hijos imprime el valor
            crudo, y el centinela de "sin filtro" terminaba en pantalla como
            `__all__`. */}
        <SelectValue>
          {selected ? (
            <span className="inline-flex items-center gap-1.5">
              <span>
                <span className="text-muted-foreground">{label}: </span>
                {selected.name}
              </span>
              {selectedBadge && (
                <Badge variant="secondary" className="font-caption">
                  {selectedBadge}
                </Badge>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {empty ? `${label}: sin opciones` : label}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>

      {/* `alignItemWithTrigger={false}`: el default de Base UI posiciona el
          popup con la opción seleccionada ENCIMA del trigger, estilo select
          nativo de macOS, y eso tapaba la etiqueta del filtro con su propia
          opción activa. Así se abre debajo y la etiqueta queda siempre visible. */}
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

function toggleStatus(current: BookingStatus[], status: BookingStatus): BookingStatus[] {
  const next = current.includes(status)
    ? current.filter((entry) => entry !== status)
    : [...current, status];
  // Unchecking everything would render an empty calendar with no way to tell
  // "nothing matches" from "nothing selected" — fall back to the defaults.
  return next.length > 0 ? next : [...DEFAULT_STATUSES];
}

function isDefaultStatuses(statuses: BookingStatus[]): boolean {
  return (
    statuses.length === DEFAULT_STATUSES.length &&
    statuses.every((status) => DEFAULT_STATUSES.includes(status))
  );
}
