/**
 * Feature 028: filtro + ordenamiento en cliente de la lista de proyectos.
 *
 * Funciones puras, sin JSX ni acceso a stores — se testean sueltas en
 * `tests/unit/projects-filter-sort.test.ts` sin tocar vite/next.
 *
 * **Buscador**: match por `project.name` **o** `client.name`, case-insensitive
 * y con acentos normalizados — "cordoba" matchea "Córdoba" y "ñandú" matchea
 * "Ñandú". El patrón es `.normalize("NFD").replace(/\p{Diacritic}/gu, "")` que
 * descompone el carácter acentuado y descarta los diacríticos sin tocar la
 * letra base.
 *
 * **Orden**: `Intl.Collator("es-AR", { sensitivity: "base" })` resuelve
 * locale-aware (la "Ñ" cae donde el PM espera, no al final del ASCII). Para
 * el `status` ordenamos por el boolean `active` directo: en `asc` los activos
 * quedan arriba (`true` > `false` cuando ordenás booleans como numbers), para
 * que el default "Solo activos" muestre lo más relevante primero cuando el
 * usuario apaga el filtro.
 */

import type { ProjectListRow } from "./workspace";

import type { ProjectsSort, ProjectsDir } from "./url";

const COLLATOR = new Intl.Collator("es-AR", { sensitivity: "base" });

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function filterProjects(
  projects: ProjectListRow[],
  opts: { q: string; onlyActive: boolean },
): ProjectListRow[] {
  const needle = normalize(opts.q.trim());

  return projects.filter((project) => {
    if (opts.onlyActive && !project.active) return false;
    if (!needle) return true;

    const name = normalize(project.name);
    const client = project.client ? normalize(project.client.name) : "";
    return name.includes(needle) || client.includes(needle);
  });
}

export function sortProjects(
  projects: ProjectListRow[],
  sort: ProjectsSort,
  dir: ProjectsDir,
): ProjectListRow[] {
  const multiplier = dir === "asc" ? 1 : -1;

  // Copia para no mutar el input; `sort()` muta in-place.
  const copy = [...projects];
  copy.sort((a, b) => {
    switch (sort) {
      case "key":
        return multiplier * COLLATOR.compare(a.key, b.key);
      case "name":
        return multiplier * COLLATOR.compare(a.name, b.name);
      case "client":
        return multiplier * COLLATOR.compare(a.client?.name ?? "", b.client?.name ?? "");
      case "pm":
        return multiplier * COLLATOR.compare(a.pm?.name ?? "", b.pm?.name ?? "");
      case "status":
        // `active` true primero cuando asc; mantiene el orden por nombre
        // como desempate para que la lista no "salte" entre renders.
        if (a.active !== b.active) {
          return multiplier * (a.active ? -1 : 1);
        }
        return COLLATOR.compare(a.name, b.name);
    }
  });

  return copy;
}

/**
 * ¿Puede este usuario togglear el estado activo de este proyecto?
 *
 * Admin siempre puede. El PM primario del proyecto también. El resto, no.
 * Se centraliza acá para que el `<ProjectList>` y los tests compartan la
 * regla sin reimplementarla (y, por si en el futuro aparece otra operación
 * con el mismo criterio, para que viva en un solo lugar).
 */
export function canToggleActive(
  isAdmin: boolean,
  pmId: string | null | undefined,
  currentUserId: string,
): boolean {
  if (isAdmin) return true;
  if (!pmId) return false;
  return pmId === currentUserId;
}
