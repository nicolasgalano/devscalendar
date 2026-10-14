import { describe, expect, it } from "vitest";

import {
  filterItems,
  type SearchableItem,
} from "@/components/time-entries/searchable-selector-filter";

/**
 * 027 — El filtro puro del `<SearchableSelector>`. El componente completo
 * (Popover + Input + lista + clearable) se verifica a mano en producción;
 * la lógica que vale testear es el matcheo.
 */

const ITEMS: SearchableItem[] = [
  { id: "1", label: "Andocia", meta: "Hernández" },
  { id: "2", label: "Hilcov Platform", meta: "Hilcov" },
  { id: "3", label: "DevsCalendar", meta: "Interno" },
  { id: "4", label: "ANDA", meta: null as unknown as string }, // meta null edge case
];

describe("027 SearchableSelector — filterItems", () => {
  it("query vacío devuelve toda la lista", () => {
    expect(filterItems(ITEMS, "")).toEqual(ITEMS);
  });

  it("solo whitespace también devuelve toda la lista", () => {
    expect(filterItems(ITEMS, "   ")).toEqual(ITEMS);
  });

  it("matchea label case-insensitive", () => {
    const result = filterItems(ITEMS, "and");
    expect(result.map((it) => it.id).sort()).toEqual(["1", "4"]);
  });

  it("matchea meta case-insensitive", () => {
    const result = filterItems(ITEMS, "hilcov");
    expect(result.map((it) => it.id)).toEqual(["2"]);
  });

  it("matchea substring en el medio del label", () => {
    const result = filterItems(ITEMS, "endar");
    expect(result.map((it) => it.id)).toEqual(["3"]);
  });

  it("sin match devuelve array vacío", () => {
    expect(filterItems(ITEMS, "xyzxyz")).toEqual([]);
  });

  it("trim al query antes de comparar", () => {
    const result = filterItems(ITEMS, "  Andocia  ");
    expect(result.map((it) => it.id)).toEqual(["1"]);
  });

  it("meta null/undefined no revienta", () => {
    const items: SearchableItem[] = [
      { id: "a", label: "foo" },
      { id: "b", label: "bar", meta: undefined },
    ];
    expect(filterItems(items, "fo").map((it) => it.id)).toEqual(["a"]);
    expect(filterItems(items, "bar").map((it) => it.id)).toEqual(["b"]);
  });

  it("items vacíos devuelve array vacío", () => {
    expect(filterItems([], "any")).toEqual([]);
    expect(filterItems([], "")).toEqual([]);
  });
});
