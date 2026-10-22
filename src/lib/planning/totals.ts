/**
 * Feature 029: totales de la grilla de `/planning`.
 *
 * Puro para que viva junto a `range.ts`/`url.ts` sin arrastrar queries ni
 * componentes. Los tres consumidores (footer de columna, margen de fila,
 * tests) importan de acá.
 */

import { PLANNING_WEEK_SIZE } from "./constants";

export type Estimate = {
  projectId: string;
  devId: string;
  date: string; // yyyy-MM-dd
  hours: number;
};

/**
 * Horas totales del proyecto por día: la suma sobre todos los devs de las
 * estimaciones que caen en ese día. Devuelve un `Map` para `O(1)` lookup
 * desde el footer de la grilla; las fechas que no aparecen en los datos no
 * están en el map (el consumidor cae a 0 por default).
 */
export function sumByDay(estimates: Estimate[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const estimate of estimates) {
    totals.set(estimate.date, (totals.get(estimate.date) ?? 0) + estimate.hours);
  }
  return totals;
}

/**
 * Horas por (project, dev, semana). Keyed por `${projectId}:${devId}`
 * porque el mismo dev puede estar en varios proyectos en el modo
 * todos-los-proyectos.
 *
 * La "semana" se cuenta desde el primer día de `days` en buckets de 7 —
 * no mira el día de la semana, confía en que `days[0]` ya es un lunes
 * (`getCapacityWeekBounds` lo garantiza).
 */
export function sumByDevWeek(
  estimates: Estimate[],
  days: string[],
): Map<string, Map<number, number>> {
  const dateToWeek = new Map<string, number>();
  days.forEach((date, index) => {
    dateToWeek.set(date, Math.floor(index / PLANNING_WEEK_SIZE));
  });

  const result = new Map<string, Map<number, number>>();
  for (const estimate of estimates) {
    const weekIndex = dateToWeek.get(estimate.date);
    if (weekIndex === undefined) continue; // estimación fuera del rango visible

    const key = `${estimate.projectId}:${estimate.devId}`;
    let perWeek = result.get(key);
    if (!perWeek) {
      perWeek = new Map();
      result.set(key, perWeek);
    }
    perWeek.set(weekIndex, (perWeek.get(weekIndex) ?? 0) + estimate.hours);
  }
  return result;
}

/**
 * Horas por proyecto y por día. Para el subtotal "Total proyecto X" que
 * se renderiza al cierre de cada bloque en el modo todos-los-proyectos.
 */
export function sumByProjectDay(
  estimates: Estimate[],
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const estimate of estimates) {
    let perDay = result.get(estimate.projectId);
    if (!perDay) {
      perDay = new Map();
      result.set(estimate.projectId, perDay);
    }
    perDay.set(estimate.date, (perDay.get(estimate.date) ?? 0) + estimate.hours);
  }
  return result;
}
