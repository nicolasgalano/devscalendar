/**
 * Formateo de minutos para display en UI. Convenciones:
 *   - `Xh Ymin` es el formato "verboso" para listas y cards.
 *   - `X:YY` es el formato "compacto" para columnas densas de tablas.
 *   - Sin `0h` cuando son menos de una hora — mejor "45min" que "0h 45min".
 *   - Sin `0min` cuando son horas exactas — mejor "2h" que "2h 0min".
 */
export function formatMinutesVerbose(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

export function formatMinutesCompact(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

/**
 * Total del día como decimal — "7.5h", "8h", "3.25h". Sirve para headers de
 * columnas y para totales grandes donde `Xh Ymin` empieza a ocupar mucho.
 */
export function formatMinutesDecimal(minutes: number): string {
  const decimal = minutes / 60;
  const rounded = Math.round(decimal * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded}h`;
}

/**
 * Formato "cronómetro corriendo": `H:MM:SS`. Para el pill del timer activo,
 * donde el usuario necesita ver cambiar el valor cada segundo o la pantalla
 * se siente congelada (reportado por el equipo). El contador del timer vive
 * en segundos para que el display tenga a qué actualizarse — las time_entries
 * finales siguen en minutos redondeados a múltiplos de 15.
 *
 * Horas sin pad (sin "00:" delante) para que el ancho sea estable y no
 * agrande la pill: `0:00:45`, `0:12:34`, `1:23:45`, `12:34:56`.
 */
export function formatSecondsClock(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Formato "tiempo transcurrido" para el bloque de aviso de un timer olvidado
 * (feature 030). Se busca una lectura humana corta sin tanta precisión:
 *   - 59s o menos → "menos de 1 min"
 *   - 1-59 min → "N min"
 *   - 1-23 h → "N h" o "N h M min" si M > 0
 *   - ≥ 24 h → "N d" o "N d H h" si H > 0
 *
 * Se evitan segundos para timers de más de 1 min — el objetivo es que el
 * usuario entienda "cuánto rato", no una duración exacta.
 */
export function humanizeElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return "menos de 1 min";
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes === 0 ? `${hours} h` : `${hours} h ${remMinutes} min`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${days} d` : `${days} d ${remHours} h`;
}
