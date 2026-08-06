/**
 * Categorical colour for calendar blocks — DESIGN.md §2 "La excepción del
 * calendario". Only inside the grid, never in tables, forms, navigation or
 * badges.
 *
 * The hue follows the grouping axis: by developer when grouping by developer,
 * by project when grouping by project (functional spec §4.2).
 */

export const CATEGORY_COUNT = 8;

export type CategoryIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Deterministic hue for an entity, from its uuid. Stable across sessions,
 * views and users, with no column in the database and no server state.
 *
 * FNV-1a: tiny, and it spreads uuids evenly enough — which matters because
 * uuids share long common prefixes and a naive sum would clump them.
 *
 * Two entities can land on the same hue. That is acceptable: the block always
 * shows developer and project as text (DESIGN.md §2, condition 3), so colour is
 * never the only identifier.
 */
export function categoryIndex(id: string): CategoryIndex {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ((hash % CATEGORY_COUNT) + 1) as CategoryIndex;
}

/**
 * Static class strings, one per hue. Written out in full because Tailwind scans
 * source for literal class names: a template like `bg-cat-${n}-surface` produces
 * no CSS at all.
 */
const CATEGORY_CLASSES: Record<CategoryIndex, string> = {
  1: "bg-cat-1-surface border-l-cat-1-line",
  2: "bg-cat-2-surface border-l-cat-2-line",
  3: "bg-cat-3-surface border-l-cat-3-line",
  4: "bg-cat-4-surface border-l-cat-4-line",
  5: "bg-cat-5-surface border-l-cat-5-line",
  6: "bg-cat-6-surface border-l-cat-6-line",
  7: "bg-cat-7-surface border-l-cat-7-line",
  8: "bg-cat-8-surface border-l-cat-8-line",
};

export function categoryClasses(id: string): string {
  return CATEGORY_CLASSES[categoryIndex(id)];
}
