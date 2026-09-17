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
