import { BookingBlock } from "@/components/calendar/booking-block";
import { DayGridSlots } from "@/components/calendar/day-grid-slots";
import {
  canManageProject,
  canRespondToBooking,
  type BookingViewer,
} from "@/lib/bookings/permissions";
import { formatMinuteOfDay } from "@/lib/calendar/format";
import { assignColumns, groupIntoLanes, rowCount, toGridRows } from "@/lib/calendar/layout";
import type { CalendarBooking } from "@/lib/calendar/query";
import {
  MINUTES_PER_ROW,
  minutesOfDay,
  visibleDayWindow,
  zonedToInstant,
} from "@/lib/calendar/range";
import { addDays } from "@/lib/calendar/range";
import { isWorkday, WORKDAY_END_HOUR, WORKDAY_START_HOUR } from "@/lib/calendar/workdays";
import { cn } from "@/lib/utils";
import type { CalendarGroup } from "@/lib/validation/calendar";

/** DESIGN.md §5: 30-minute slot = 24px, lane ≥ 160px. */
const ROW_HEIGHT = 24;
const LANE_MIN_WIDTH = 160;
const GUTTER_WIDTH = 56;

export function DayView({
  bookings,
  isoDate,
  group,
  tz,
  viewer,
}: {
  bookings: CalendarBooking[];
  isoDate: string;
  group: CalendarGroup;
  tz: string;
  /** Quién mira: decide qué bloques ofrecen editar y cancelar. */
  viewer: BookingViewer | null;
}) {
  const window = visibleDayWindow(bookings, isoDate, tz);
  const rows = rowCount(window);
  const workday = isWorkday(isoDate);

  // AC-3.1 / AC-3.2: one lane per entity present in the range, following the
  // grouping axis. The categorical hue follows the same axis (spec §4.2).
  const lanes = groupIntoLanes(bookings, (booking) =>
    group === "dev"
      ? { id: booking.dev.id, name: booking.dev.name }
      : { id: booking.project.id, name: booking.project.name },
  );

  const dayStart = zonedToInstant(isoDate, tz).getTime();
  const dayEnd = zonedToInstant(addDays(isoDate, 1), tz).getTime();

  /** Minutes from local midnight, clamped to the day being rendered. */
  function localMinutes(booking: CalendarBooking) {
    const starts = new Date(booking.startsAt).getTime();
    const ends = new Date(booking.endsAt).getTime();
    return {
      startMinute: starts <= dayStart ? 0 : minutesOfDay(booking.startsAt, tz),
      endMinute: ends >= dayEnd ? 24 * 60 : minutesOfDay(booking.endsAt, tz) || 24 * 60,
    };
  }

  const slots = Array.from(
    { length: rows },
    (_, index) => window.startMinute + index * MINUTES_PER_ROW,
  );

  return (
    // `pb-3` deja lugar a la etiqueta de cierre, que sobresale 8px por debajo
    // de la última franja: `overflow-x-auto` obliga al eje vertical a
    // recortar, así que sin ese padding quedaría cortada.
    <div className="overflow-x-auto pb-3">
      {/*
        Un solo grid para encabezados y cuerpo, a propósito: una única
        `grid-template-columns` es lo que garantiza que cada encabezado mida
        exactamente lo mismo que su carril. Separarlos en dos grids obligaría a
        duplicar la plantilla y a confiar en que ambas resuelvan igual.

        La separación entre la fila de encabezados y la del cuerpo se declara
        una sola vez con `gap-y`, no con un margen por columna. Sin ella, la
        etiqueta de la primera hora —que se centra sobre la línea de su franja,
        y por lo tanto sobresale hacia arriba— se superpone con el encabezado.
      */}
      <div
        className="grid min-w-full gap-y-3"
        style={{
          gridTemplateColumns: `${GUTTER_WIDTH}px repeat(${lanes.length}, minmax(${LANE_MIN_WIDTH}px, 1fr))`,
        }}
      >
        {/* Lane headers — sticky so they survive the vertical scroll (§6). */}
        <div className="border-border bg-background sticky top-0 z-20 h-8 border-b" />
        {lanes.map((lane) => (
          <div
            key={lane.id}
            // Gancho estable para los tests: engancharse a clases de Tailwind
            // las convierte en API y rompe el día que cambie el estilo.
            data-lane-header={lane.id}
            className="border-border bg-background sticky top-0 z-20 flex h-8 items-center border-b border-l px-2"
          >
            <span className="text-caption text-muted-foreground truncate font-medium">
              {lane.name}
            </span>
          </div>
        ))}

        {/* Hour gutter. */}
        <div className="grid" style={{ gridTemplateRows: `repeat(${rows}, ${ROW_HEIGHT}px)` }}>
          {slots.map((minute, index) => (
            <div key={minute} className="relative">
              {minute % 60 === 0 && (
                <span className="font-data text-caption text-muted-foreground absolute -top-2 right-2">
                  {formatMinuteOfDay(minute)}
                </span>
              )}
              {/* Closing label. Only the *start* of each slot gets a label, so
                  without this the grid would end on an unnumbered line — and
                  that line is meaningful: it is where the workday closes. */}
              {index === slots.length - 1 && (
                <span className="font-data text-caption text-muted-foreground absolute right-2 -bottom-2">
                  {formatMinuteOfDay(window.endMinute)}
                </span>
              )}
            </div>
          ))}
        </div>

        {lanes.map((lane) => {
          const positioned = assignColumns(lane.items);

          return (
            <div
              key={lane.id}
              className="border-border relative grid border-l"
              style={{ gridTemplateRows: `repeat(${rows}, ${ROW_HEIGHT}px)` }}
            >
              {slots.map((minute) => {
                // Slots outside the workday are shaded so the boundary of the
                // normal day reads at a glance: working past 17:00 is
                // exceptional (Q-G) and has to look like it.
                const outsideWorkday =
                  !workday || minute < WORKDAY_START_HOUR * 60 || minute >= WORKDAY_END_HOUR * 60;

                return (
                  <div
                    key={minute}
                    aria-hidden="true"
                    className={cn(
                      "border-t",
                      minute % 60 === 0 ? "border-border" : "border-border/50",
                      outsideWorkday && "bg-muted/60",
                    )}
                  />
                );
              })}

              {/* Antes que los bloques a propósito: la capa de alta cubre todo
                  el carril, y lo que se dibuja después queda por encima. Así un
                  click sobre una reserva abre su detalle y no el formulario. */}
              <DayGridSlots
                lane={{ axis: group, id: lane.id }}
                laneName={lane.name}
                isoDate={isoDate}
                window={window}
                rowHeight={ROW_HEIGHT}
              />

              {positioned.map(({ item, column, columns }) => (
                <BookingBlock
                  key={item.id}
                  booking={item}
                  rows={toGridRows(localMinutes(item), window)}
                  column={column}
                  columns={columns}
                  colorKey={group === "dev" ? item.dev.id : item.project.id}
                  tz={tz}
                  canManage={canManageProject(viewer, item.project)}
                  canRespond={canRespondToBooking(viewer, item)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
