// 027. Helper puro del `<SearchableSelector>` extraído a un archivo `.ts`
// aparte para que los unit tests (`tests/unit/*.test.ts`, config vitest sin
// JSX) puedan importarlo sin triggerear el parser JSX de vite sobre el
// componente completo (`.tsx`).

export type SearchableItem = {
  id: string;
  label: string;
  // `meta` entra también al filtro — útil para ticket.key o cliente. En el
  // renderer se muestra como texto secundario a la izquierda.
  meta?: string | null;
};

// Case-insensitive substring sobre `label + meta`. Query vacía o solo
// whitespace devuelve toda la lista.
export function filterItems(
  items: readonly SearchableItem[],
  query: string,
): readonly SearchableItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return items;
  return items.filter((it) => {
    const label = it.label.toLowerCase();
    const meta = (it.meta ?? "").toLowerCase();
    return label.includes(q) || meta.includes(q);
  });
}
