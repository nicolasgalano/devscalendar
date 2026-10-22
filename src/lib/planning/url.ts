/**
 * Feature 029: estado de `/planning` en search params.
 *
 * Dos campos:
 *   - `project`: la clave del proyecto seleccionado (ej. `PROJ`). Null
 *     cuando el usuario no eligió nada todavía — la grilla muestra
 *     EmptyState.
 *   - `w`: fecha ISO `YYYY-MM-DD` de la primera columna de la grilla.
 *     Null cuando se está en el ancla por default ("hoy en la cuarta
 *     fila"). Al navegar con las flechas pasa a tener valor; al clickear
 *     "Hoy" vuelve a null.
 *
 * Convenciones del repo (ver `src/lib/calendar/url.ts`): parser tolerante,
 * serializer que no escribe defaults, round-trip estable.
 */

export const PLANNING_PATH = "/planning";

export type PlanningUrl = {
  project: string | null;
  w: string | null;
};

export const DEFAULT_PLANNING_URL: PlanningUrl = {
  project: null,
  w: null,
};

const PROJECT_KEY_RX = /^[A-Z][A-Z0-9]{1,7}$/;
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export function parsePlanningUrl(sp: URLSearchParams): PlanningUrl {
  const rawProject = sp.get("project");
  const project =
    rawProject && PROJECT_KEY_RX.test(rawProject) ? rawProject : DEFAULT_PLANNING_URL.project;

  const rawW = sp.get("w");
  const w = rawW && ISO_DATE_RX.test(rawW) ? rawW : DEFAULT_PLANNING_URL.w;

  return { project, w };
}

export function planningHref(
  current: PlanningUrl,
  patch: Partial<PlanningUrl> = {},
): string {
  const next: PlanningUrl = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.project !== DEFAULT_PLANNING_URL.project && next.project) {
    params.set("project", next.project);
  }
  if (next.w !== DEFAULT_PLANNING_URL.w && next.w) {
    params.set("w", next.w);
  }
  const qs = params.toString();
  return qs ? `${PLANNING_PATH}?${qs}` : PLANNING_PATH;
}
