/**
 * Feature 028: estado de la lista de proyectos en search params.
 *
 * Convención del proyecto (ver `src/lib/calendar/url.ts`): el parser nunca tira
 * — una query malformada cae a defaults. Y el serializer no escribe valores
 * iguales al default, para que el caso común (`/projects`) sea una URL corta y
 * legible, no un wall de params redundantes.
 *
 * El filtro de "activos" es el único con un comportamiento no trivial: su
 * default es "on" (mostrar solo activos). Un `active=on` explícito en la URL
 * se omite al serializar, pero el parser lo acepta — ida y vuelta estable.
 */

export const PROJECTS_PATH = "/projects";

export const PROJECTS_SORTS = ["key", "name", "client", "pm", "status"] as const;
export type ProjectsSort = (typeof PROJECTS_SORTS)[number];

export const PROJECTS_DIRS = ["asc", "desc"] as const;
export type ProjectsDir = (typeof PROJECTS_DIRS)[number];

export const PROJECTS_ACTIVES = ["on", "all"] as const;
export type ProjectsActive = (typeof PROJECTS_ACTIVES)[number];

export type ProjectsListUrl = {
  q: string;
  active: ProjectsActive;
  sort: ProjectsSort;
  dir: ProjectsDir;
};

export const DEFAULT_PROJECTS_URL: ProjectsListUrl = {
  q: "",
  active: "on",
  sort: "name",
  dir: "asc",
};

export function parseProjectsUrl(sp: URLSearchParams): ProjectsListUrl {
  // El `q` crudo se recorta de espacios pero se preserva su contenido — el
  // filtro aplicativo normaliza acentos / case, no acá.
  const rawQ = sp.get("q") ?? "";
  const q = rawQ.trim();

  const rawActive = sp.get("active");
  const active: ProjectsActive =
    rawActive && (PROJECTS_ACTIVES as readonly string[]).includes(rawActive)
      ? (rawActive as ProjectsActive)
      : DEFAULT_PROJECTS_URL.active;

  const rawSort = sp.get("sort");
  const sort: ProjectsSort =
    rawSort && (PROJECTS_SORTS as readonly string[]).includes(rawSort)
      ? (rawSort as ProjectsSort)
      : DEFAULT_PROJECTS_URL.sort;

  const rawDir = sp.get("dir");
  const dir: ProjectsDir =
    rawDir && (PROJECTS_DIRS as readonly string[]).includes(rawDir)
      ? (rawDir as ProjectsDir)
      : DEFAULT_PROJECTS_URL.dir;

  return { q, active, sort, dir };
}

export function projectsHref(
  current: ProjectsListUrl,
  patch: Partial<ProjectsListUrl> = {},
): string {
  const next: ProjectsListUrl = { ...current, ...patch };
  const params = new URLSearchParams();

  if (next.q !== DEFAULT_PROJECTS_URL.q) params.set("q", next.q);
  if (next.active !== DEFAULT_PROJECTS_URL.active) params.set("active", next.active);
  if (next.sort !== DEFAULT_PROJECTS_URL.sort) params.set("sort", next.sort);
  if (next.dir !== DEFAULT_PROJECTS_URL.dir) params.set("dir", next.dir);

  const qs = params.toString();
  return qs ? `${PROJECTS_PATH}?${qs}` : PROJECTS_PATH;
}

/**
 * Devuelve el `dir` que corresponde cuando el usuario clickea un header: si
 * el header ya era el activo, invierte; si era otro, arranca ascendente.
 */
export function nextSortDir(
  current: ProjectsListUrl,
  clickedSort: ProjectsSort,
): ProjectsDir {
  if (current.sort !== clickedSort) return "asc";
  return current.dir === "asc" ? "desc" : "asc";
}
