/**
 * Feature 029: cómputo de los 28 días visibles de la grilla de `/planning`.
 *
 * **Hoy ancla en la cuarta fila** por default (patrón 024): la grilla
 * muestra 3 semanas pasadas + la semana en curso, igual que
 * `/calendar?view=planning` cuando se entra sin `?date`. El PM mira
 * primero lo que ya pasó para decidir cómo distribuir la carga nueva.
 *
 * El cómputo se duplica a propósito con el case "planning" de
 * `src/lib/calendar/range.ts`: capacity planning no es un view del
 * calendar, y acoplar los dos obligaría al case del calendar a conocer
 * una ruta que no vive adentro de él.
 */

import { addDays, mondayOf } from "@/lib/calendar/range";

import { PLANNING_VISIBLE_DAYS } from "./constants";

/**
 * Devuelve los 28 días visibles y la fecha de arranque de la grilla.
 *
 * - `today` (`YYYY-MM-DD`): fecha "hoy" en la TZ del viewer.
 * - `offsetWeeks`: 0 = ancla por default (hoy en la cuarta fila), 1 = una
 *   semana adelante, -1 = una semana atrás. La URL del `/planning` guarda
 *   el `weekStart` directo cuando el usuario navega — ese caso llama a
 *   `getCapacityWeekBoundsFromStart` abajo.
 */
export function getCapacityWeekBounds(
  today: string,
  offsetWeeks: number = 0,
): { weekStart: string; days: string[] } {
  const todayMonday = mondayOf(today);
  // 3 semanas atrás de hoy → "hoy en la cuarta fila" cuando offset=0.
  const defaultStart = addDays(todayMonday, -21);
  const weekStart = addDays(defaultStart, offsetWeeks * 7);
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
