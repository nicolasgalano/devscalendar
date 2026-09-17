/**
 * Aritmética de semanas para "Mi Tiempo" (016 T3.2). La semana empieza el
 * **lunes** (convención local — sábado y domingo van al final).
 *
 * Todo el manejo pasa por strings YYYY-MM-DD; se evita `Date` en el core para
 * que los helpers sean puros y no dependan de la timezone del runtime más
 * que en el input del usuario. El `<input type="date">` produce strings ISO
 * ya en fecha local del navegador.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Devuelve el lunes de la semana que contiene a `date` como string ISO
 * (YYYY-MM-DD). Trabaja en UTC para evitar sorpresas por DST.
 */
export function getWeekStart(date: Date | string): string {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00Z`) : new Date(date);
  const utcDay = d.getUTCDay(); // 0 = domingo, 1 = lunes, ..., 6 = sábado
  const offset = utcDay === 0 ? -6 : 1 - utcDay; // lunes = day 1
  const monday = new Date(d.getTime() + offset * MS_PER_DAY);
  return monday.toISOString().slice(0, 10);
}

/**
 * Los 7 días de la semana como strings ISO, empezando por el lunes.
 */
export function getWeekDays(weekStart: string): string[] {
  const monday = new Date(`${weekStart}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday.getTime() + i * MS_PER_DAY);
    return day.toISOString().slice(0, 10);
  });
}

/**
 * Semana previa / siguiente — para los botones `<` `>` del navegador.
 */
export function shiftWeek(weekStart: string, byWeeks: number): string {
  const monday = new Date(`${weekStart}T00:00:00Z`);
  const shifted = new Date(monday.getTime() + byWeeks * 7 * MS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}

/**
 * "Esta semana" contra el navegador. Sirve como default cuando la URL no
 * trae `?w=YYYY-MM-DD`.
 */
export function currentWeekStart(): string {
  return getWeekStart(new Date());
}

/**
 * Parsea `?w=YYYY-MM-DD` con fallback a la semana actual. Nunca tira:
 * strings inválidos caen al default. Devuelve siempre el **lunes** — si el
 * usuario mete un miércoles, se resuelve al lunes de esa semana.
 */
export function parseWeekParam(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return currentWeekStart();
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return currentWeekStart();
  return getWeekStart(d);
}

/**
 * Etiqueta corta para el header de una columna del día: "lun 15" / "sab 20"
 * en `es-AR`, sin zona horaria (todo en UTC para consistencia).
 */
export function formatDayHeader(dateIso: string): { weekday: string; day: string } {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const weekday = d.toLocaleDateString("es-AR", {
    weekday: "short",
    timeZone: "UTC",
  });
  const day = String(d.getUTCDate());
  return { weekday, day };
}
