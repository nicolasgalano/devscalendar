/**
 * DESIGN.md §11: fechas recientes en relativo (`hace 2 h`) con la absoluta en
 * el `title`; más de siete días, fecha absoluta. Un helper propio porque no
 * hay `date-fns` en el proyecto — para 6 usuarios y ~100 tickets/mes no vale
 * agregar la dep entera por esto.
 */

const RTF = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto", style: "short" });

const ABSOLUTE = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function formatRelativeShort(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  const diffMs = Date.now() - date.getTime();

  if (Math.abs(diffMs) > SEVEN_DAYS_MS) {
    return ABSOLUTE.format(date);
  }

  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 60) {
    return RTF.format(-minutes, "minute");
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return RTF.format(-hours, "hour");
  }
  const days = Math.round(hours / 24);
  return RTF.format(-days, "day");
}

/** Fecha absoluta larga para el `title` del elemento relativo. */
export function formatAbsoluteFull(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
