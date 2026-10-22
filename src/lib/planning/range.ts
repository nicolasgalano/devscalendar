/**
 * Feature 029: cómputo de los 28 días visibles de la grilla de `/planning`.
 *
 * **Hoy ancla en la PRIMERA fila** por default: la grilla muestra la
 * semana en curso + las 3 siguientes. A diferencia de
 * `/calendar?view=planning` (que mira hacia atrás porque el valor está
 * en el contexto histórico de las reservas), capacity planning es
 * forward-looking: lo útil es ver desde hoy hacia adelante.
 *
 * El cómputo se mantiene local a `src/lib/planning/*` (no se delega a
 * `src/lib/calendar/range.ts`) porque capacity planning no es un view
 * del calendar y mezclarlos obligaría al case del calendar a conocer una
 * ruta que no vive adentro.
 */

import { addDays, mondayOf } from "@/lib/calendar/range";

import { PLANNING_VISIBLE_DAYS } from "./constants";

/**
 * Devuelve los 28 días visibles y la fecha de arranque de la grilla.
 *
 * - `today` (`YYYY-MM-DD`): fecha "hoy" en la TZ del viewer.
 * - `offsetWeeks`: 0 = ancla por default (hoy en la primera fila),
 *   1 = una semana adelante, -1 = una semana atrás. La URL del `/planning`
 *   guarda el `weekStart` directo cuando el usuario navega — ese caso
 *   llama a `getCapacityWeekBoundsFromStart` abajo.
 */
export function getCapacityWeekBounds(
  today: string,
  offsetWeeks: number = 0,
): { weekStart: string; days: string[] } {
  const todayMonday = mondayOf(today);
  // Hoy en la primera fila: la grilla arranca en el lunes de la semana
  // actual y muestra 4 semanas hacia adelante.
  const weekStart = addDays(todayMonday, offsetWeeks * 7);
  return { weekStart, days: daysFrom(weekStart) };
}

/**
 * Variante que acepta la fecha de arranque directa (lo que vive en la URL
 * cuando el usuario navegó explícitamente con las flechas).
 */
export function getCapacityWeekBoundsFromStart(weekStart: string): {
  weekStart: string;
  days: string[];
} {
  const normalized = mondayOf(weekStart);
  return { weekStart: normalized, days: daysFrom(normalized) };
}

function daysFrom(start: string): string[] {
  return Array.from({ length: PLANNING_VISIBLE_DAYS }, (_, index) => addDays(start, index));
}
