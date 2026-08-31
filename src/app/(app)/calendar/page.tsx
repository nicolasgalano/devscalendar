import Link from "next/link";

import { BookingActionsProvider, CreateBookingButton } from "@/components/calendar/booking-actions";
import { BookingResponseProvider } from "@/components/calendar/booking-response";
import { bookingStatusLabel } from "@/components/calendar/booking-status";
import { CalendarFilters } from "@/components/calendar/calendar-filters";
import { CalendarPendingProvider, CalendarResults } from "@/components/calendar/calendar-pending";
import { CalendarToolbar } from "@/components/calendar/calendar-toolbar";
import { DayView } from "@/components/calendar/day-view";
import { MonthView } from "@/components/calendar/month-view";
import { YearView } from "@/components/calendar/year-view";
import { EmptyState, NoResultsState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getBookingFormOptions } from "@/lib/bookings/options";
import type { BookingViewer } from "@/lib/bookings/permissions";
import { deriveFacets } from "@/lib/calendar/facets";
import { aggregateDayLoad } from "@/lib/calendar/load";
import {
  getBookingsInRange,
  getDayLoad,
  getFilterFacets,
  getSelectedFilterNames,
  type SelectedFilterNames,
} from "@/lib/calendar/query";
import { eachDay, resolveRange, todayInTimeZone, viewBounds } from "@/lib/calendar/range";
import { clearFiltersHref } from "@/lib/calendar/url";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import {
  DEFAULT_STATUSES,
  hasActiveFilters,
  parseCalendarParams,
  type CalendarParams,
} from "@/lib/validation/calendar";

export const dynamic = "force-dynamic";

/**
 * Lo que se pinta, más en cuál de los tres estados quedó. El estado importa
 * fuera de la grilla: es lo que decide dónde vive la acción primaria (§7) y por
 * qué "vacío" y "sin resultados" no son el mismo cartel (§9).
 */
type ViewContent = {
  node: React.ReactNode;
  state: "data" | "empty" | "no-results";
};

/**
 * DESIGN.md §9: the "no results" state has to name the filter that is hiding
 * the data. "Nothing matches your filters" sends the user hunting; "nothing
 * matches cliente Nimbus SRL and prioritario" tells them what to undo.
 */
function describeFilters(params: CalendarParams, names: SelectedFilterNames): string {
  // Los nombres se buscan por id, no en las facetas: justo cuando no hay
  // resultados la faceta puede venir vacía y el nombre no resolvería.
  const parts = [
    params.filters.clientId && names.client && `cliente ${names.client}`,
    params.filters.projectId && names.project && `proyecto ${names.project}`,
    params.filters.devId && names.dev && `desarrollador ${names.dev}`,
    params.filters.pmId && names.pm && `PM ${names.pm}`,
    params.filters.priority &&
      (params.filters.priority === "high" ? "prioridad prioritario" : "prioridad común"),
    !sameAsDefaultStatuses(params.filters.statuses) &&
      `estado ${params.filters.statuses.map(bookingStatusLabel).join(" o ").toLowerCase()}`,
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) return "los filtros aplicados";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
}

function sameAsDefaultStatuses(statuses: string[]): boolean {
  return (
    statuses.length === DEFAULT_STATUSES.length &&
    statuses.every((status) => DEFAULT_STATUSES.includes(status as never))
  );
}

/**
 * Q-10 default: bookings are stored in UTC and rendered in the viewer's
 * timezone. Server-rendered, so "the viewer's timezone" cannot be read from the
 * browser — it is fixed to the team's timezone for now. When Q-10 is answered
 * (per project, per user), this constant is what changes; every conversion
 * already goes through `range.ts` (R-2).
 */
const TIMEZONE = "America/Argentina/Buenos_Aires";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const today = todayInTimeZone(TIMEZONE);
  const params = parseCalendarParams(raw, { today });

  const supabase = await createClient();
  const range = resolveRange(params.view, params.date, TIMEZONE);

  // Ya resuelto y memorizado por el layout del route group: acá no cuesta otro
  // round trip al servidor de auth (ver `lib/supabase/session.ts`).
  const profile = await getCurrentProfile();
  const viewer: BookingViewer | null = profile ? { id: profile.id, role: profile.role } : null;

  const [content, facets, options] = await Promise.all([
    params.view === "day"
      ? renderDay()
      : renderAggregated(params.view === "month" ? "month" : "year"),
    getFacets(),
    getBookingFormOptions(supabase, viewer),
  ]);

  return (
    <BookingActionsProvider viewer={viewer} options={options} params={params} tz={TIMEZONE}>
      {/*
        `005` T4.5: el desarrollador asignado responde desde el popover del
        bloque, así que sus diálogos también tienen que vivir por encima de la
        grilla. Provider aparte del de `004` y no una fusión: son dos permisos
        distintos —el PM administra, el dev se compromete— y la bandeja usa
        este solo, sin arrastrar el formulario de alta.
      */}
      <BookingResponseProvider params={params} tz={TIMEZONE}>
        <PageHeader
          title="Calendario"
          description="Reservas de tiempo de los desarrolladores sobre cada proyecto."
          // DESIGN.md §7: con la vista vacía la acción primaria se muda al empty
          // state, para que no haya dos botones primarios en pantalla.
          action={content.state === "empty" ? undefined : <CreateBookingButton />}
        />
        <CalendarToolbar params={params} today={today} tz={TIMEZONE} />
        {/* Filtros y resultados comparten una sola transición, para que al
          filtrar la pantalla dé señal en vez de quedarse quieta. */}
        <CalendarPendingProvider>
          <CalendarFilters params={params} facets={facets} />
          <CalendarResults>{content.node}</CalendarResults>
        </CalendarPendingProvider>
      </BookingResponseProvider>
    </BookingActionsProvider>
  );

  /**
   * Opciones de los filtros, derivadas de las reservas del rango visible: cada
   * opción que se ofrece devuelve resultados. Ver `deriveFacets` para por qué
   * cada faceta ignora su propio filtro.
   */
  async function getFacets() {
    const rows = await getFilterFacets(supabase, { range, filters: params.filters });
    return deriveFacets(rows, params.filters);
  }

  async function renderDay(): Promise<ViewContent> {
    const bookings = await getBookingsInRange(supabase, { range, filters: params.filters });
    if (bookings.length === 0) return emptyOrNoResults();

    return {
      state: "data",
      node: (
        <DayView
          bookings={bookings}
          isoDate={params.date}
          group={params.group}
          tz={TIMEZONE}
          viewer={viewer}
        />
      ),
    };
  }

  async function renderAggregated(view: "month" | "year"): Promise<ViewContent> {
    const { spans, devCount } = await getDayLoad(supabase, { range, filters: params.filters });
    const [from, to] = viewBounds(view, params.date);
    const days = aggregateDayLoad({
      spans,
      days: eachDay(from, to),
      tz: TIMEZONE,
      devCount,
    });

    if (spans.length === 0) return emptyOrNoResults();

    return {
      state: "data",
      node:
        view === "month" ? (
          <MonthView days={days} params={params} today={today} />
        ) : (
          <YearView days={days} params={params} tz={TIMEZONE} />
        ),
    };
  }

  /**
   * DESIGN.md §9: "empty" and "no results" are different states. With no
   * filters applied there is genuinely nothing to show; with filters on, the
   * data may well exist just outside them — saying "no bookings" there would be
   * a lie that sends the user looking for a bug.
   */
  async function emptyOrNoResults(): Promise<ViewContent> {
    if (hasActiveFilters(params.filters)) {
      const applied = describeFilters(
        params,
        await getSelectedFilterNames(supabase, params.filters),
      );
      return {
        state: "no-results",
        node: (
          <NoResultsState
            description={`Ninguna reserva coincide con ${applied} en este período.`}
            onClear={
              // Link, no botón: navega. Ver la nota en `calendar-toolbar.tsx`.
              <Link
                href={clearFiltersHref(params)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Limpiar filtros
              </Link>
            }
          />
        ),
      };
    }

    return {
      state: "empty",
      node: (
        <EmptyState
          title="Sin reservas en este período"
          description="Las reservas que se creen para el equipo van a aparecer acá."
          // Salda la deuda F2 de 003: el empty state del calendario ya tiene su
          // verbo (DESIGN.md §9, §14).
          action={<CreateBookingButton />}
        />
      ),
    };
  }
}
