/**
 * Working days and working hours — Q-F, confirmed with the client on 2026-08-05:
 * a fixed 09:00–17:00 workday, no weekends and no Argentine public holidays.
 *
 * Booking outside these bounds is exceptional but allowed: feature 004 warns and
 * never blocks (Q-G). Nothing here rejects anything — it only feeds the
 * occupancy ramp and the default window of the day view.
 */

export const WORKDAY_START_HOUR = 9;
export const WORKDAY_END_HOUR = 17;
export const WORKDAY_HOURS = WORKDAY_END_HOUR - WORKDAY_START_HOUR;
export const WORKDAY_MINUTES = WORKDAY_HOURS * 60;

/**
 * Observed dates of Argentine public holidays, already resolved: movable
 * holidays (Ley 27.399) are listed on the Monday they were moved to, not on
 * their nominal date.
 *
 * This list is NOT derivable and needs maintenance every year (R-7):
 *   · movable holidays shift depending on the weekday they land on;
 *   · "días no laborables con fines turísticos" (long-weekend bridges) are set
 *     by decree, one year at a time, and are NOT included below.
 *
 * Load the next year before each December. Consulting a year that is not in
 * this map throws — see `assertYearLoaded`.
 */
const HOLIDAYS_BY_YEAR: Readonly<Record<number, readonly string[]>> = {
  2026: [
    "2026-01-01", // Año Nuevo
    "2026-02-16", // Carnaval
    "2026-02-17", // Carnaval
    "2026-03-24", // Día de la Memoria
    "2026-04-02", // Día del Veterano y de los Caídos en Malvinas
    "2026-04-03", // Viernes Santo
    "2026-05-01", // Día del Trabajador
    "2026-05-25", // Revolución de Mayo
    "2026-06-15", // Güemes — nominal 17/06 (miércoles), movido al lunes anterior
    "2026-06-20", // Paso a la Inmortalidad de Belgrano (inamovible)
    "2026-07-09", // Día de la Independencia
    "2026-08-17", // San Martín — cae lunes, no se traslada
    "2026-10-12", // Diversidad Cultural — cae lunes, no se traslada
    "2026-11-23", // Soberanía Nacional — nominal 20/11 (viernes), al lunes siguiente
    "2026-12-08", // Inmaculada Concepción
    "2026-12-25", // Navidad
  ],
  2027: [
    "2027-01-01",
    "2027-02-08", // Carnaval
    "2027-02-09", // Carnaval
    "2027-03-24",
    "2027-03-26", // Viernes Santo
    "2027-04-02",
    "2027-05-01",
    "2027-05-25",
    "2027-06-20", // Belgrano (inamovible)
    "2027-06-21", // Güemes — nominal 17/06 (jueves), al lunes siguiente
    "2027-07-09",
    "2027-08-16", // San Martín — nominal 17/08 (martes), al lunes anterior
    "2027-10-11", // Diversidad Cultural — nominal 12/10 (martes), al lunes anterior
    "2027-11-20", // Soberanía Nacional — cae sábado, no se traslada
    "2027-12-08",
    "2027-12-25",
  ],
};

export class UnknownHolidayYearError extends Error {
  constructor(year: number) {
    super(
      `No hay feriados cargados para ${year}. Agregalos en src/lib/calendar/workdays.ts ` +
        "(se fijan por decreto, no se pueden calcular).",
    );
    this.name = "UnknownHolidayYearError";
  }
}

/**
 * Fails loudly on a year with no holiday data instead of silently treating
 * every day as a working day. A calendar that quietly counts 25 December as
 * available capacity is worse than one that refuses to render.
 */
export function assertYearLoaded(year: number): void {
  if (!HOLIDAYS_BY_YEAR[year]) throw new UnknownHolidayYearError(year);
}

export function loadedHolidayYears(): number[] {
  return Object.keys(HOLIDAYS_BY_YEAR).map(Number).sort();
}

/** @param isoDate calendar date as `YYYY-MM-DD`, already in the viewer's timezone. */
export function isHoliday(isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4));
  assertYearLoaded(year);
  return HOLIDAYS_BY_YEAR[year]!.includes(isoDate);
}

export function isWeekend(isoDate: string): boolean {
  // Parsed as UTC on purpose: `isoDate` is already a wall-clock calendar date,
  // so it must not be shifted by the runtime's timezone.
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function isWorkday(isoDate: string): boolean {
  return !isWeekend(isoDate) && !isHoliday(isoDate);
}
