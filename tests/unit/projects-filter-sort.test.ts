import { describe, expect, it } from "vitest";

import { canToggleActive, filterProjects, sortProjects } from "@/lib/projects/filter-sort";
import type { ProjectListRow } from "@/lib/projects/workspace";

/**
 * Feature 028 — T2.3. El filtro vive en cliente y es puro; el sort también.
 * Los dos tienen que hablar bien es-AR (una "Ñ" después de "N", "Córdoba"
 * matchea "cordoba") para que el PM encuentre lo que busca sin tener que
 * memorizar el ASCII.
 */

function makeProject(partial: Partial<ProjectListRow> = {}): ProjectListRow {
  // `in` chequea presencia aunque el valor sea null — así "pasar `client:
  // null`" significa "sin cliente" y no "usar el default por nullish".
  return {
    id: partial.id ?? "proj-1",
    key: partial.key ?? "PROJ",
    name: partial.name ?? "Proyecto",
    active: partial.active ?? true,
    client: "client" in partial ? partial.client ?? null : { id: "c1", name: "Cliente" },
    pm: "pm" in partial ? partial.pm ?? null : { id: "pm-1", name: "Alice" },
  };
}

describe("filterProjects", () => {
  const projects = [
    makeProject({ id: "a", name: "Córdoba Capital", client: { id: "c1", name: "Argentina SA" } }),
    makeProject({ id: "b", name: "Mendoza", client: { id: "c2", name: "Vino Export" } }),
    makeProject({ id: "c", name: "Ñandú Logística", client: { id: "c3", name: "Patagonia" } }),
    makeProject({ id: "d", name: "Rediseño Web", active: false, client: { id: "c4", name: "ACME" } }),
  ];

  it("matches by project name, case- and accent-insensitive", () => {
    expect(filterProjects(projects, { q: "cordoba", onlyActive: false }).map((p) => p.id)).toEqual([
      "a",
    ]);
    expect(filterProjects(projects, { q: "CORDOBA", onlyActive: false }).map((p) => p.id)).toEqual([
      "a",
    ]);
    expect(filterProjects(projects, { q: "nandu", onlyActive: false }).map((p) => p.id)).toEqual([
      "c",
    ]);
  });

  it("matches by client name too", () => {
    expect(filterProjects(projects, { q: "patagonia", onlyActive: false }).map((p) => p.id)).toEqual([
      "c",
    ]);
    expect(filterProjects(projects, { q: "vino", onlyActive: false }).map((p) => p.id)).toEqual([
      "b",
    ]);
  });

  it("empty q returns everything (modulated by onlyActive)", () => {
    expect(filterProjects(projects, { q: "", onlyActive: false })).toHaveLength(4);
    expect(filterProjects(projects, { q: "   ", onlyActive: false })).toHaveLength(4);
  });

  it("onlyActive strips inactives", () => {
    const active = filterProjects(projects, { q: "", onlyActive: true });
    expect(active.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("combines q with onlyActive", () => {
    expect(filterProjects(projects, { q: "web", onlyActive: true })).toEqual([]);
    expect(filterProjects(projects, { q: "web", onlyActive: false }).map((p) => p.id)).toEqual([
      "d",
    ]);
  });

  it("tolerates projects with no client", () => {
    const orphan = [makeProject({ id: "x", name: "Huérfano", client: null })];
    expect(filterProjects(orphan, { q: "huer", onlyActive: false }).map((p) => p.id)).toEqual([
      "x",
    ]);
    expect(filterProjects(orphan, { q: "cliente", onlyActive: false })).toEqual([]);
  });
});

describe("sortProjects", () => {
  const projects = [
    makeProject({ id: "a", key: "AAA", name: "Álvaro", active: true, pm: { id: "pm-1", name: "Beto" } }),
    makeProject({ id: "b", key: "BBB", name: "Ñandú", active: false, pm: { id: "pm-2", name: "Ana" } }),
    makeProject({ id: "c", key: "CCC", name: "Zebra", active: true, pm: { id: "pm-3", name: "Carla" } }),
  ];

  it("sorts by name locale-aware (es-AR): Ñ after N, not at ASCII tail", () => {
    const nz = [
      makeProject({ id: "n", name: "Natural" }),
      makeProject({ id: "ñ", name: "Ñoño" }),
      makeProject({ id: "o", name: "Oso" }),
    ];
    expect(sortProjects(nz, "name", "asc").map((p) => p.id)).toEqual(["n", "ñ", "o"]);
  });

  it("asc puts Á before Ñ before Z", () => {
    expect(sortProjects(projects, "name", "asc").map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("desc inverts", () => {
    expect(sortProjects(projects, "name", "desc").map((p) => p.id)).toEqual(["c", "b", "a"]);
  });

  it("sort by client falls back to empty string for null clients", () => {
    const mixed = [
      makeProject({ id: "x", client: null }),
      makeProject({ id: "y", client: { id: "c", name: "Beta" } }),
      makeProject({ id: "z", client: { id: "c", name: "Alfa" } }),
    ];
    expect(sortProjects(mixed, "client", "asc").map((p) => p.id)).toEqual(["x", "z", "y"]);
  });

  it("sort by pm uses pm.name", () => {
    // Ana (b), Beto (a), Carla (c) en asc.
    expect(sortProjects(projects, "pm", "asc").map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("sort by status puts active first in asc, inactive first in desc; alpha tie-breaker is stable", () => {
    // Tie-breaker por nombre siempre asc, no sigue a `dir`. Un orden que cambia
    // dentro del grupo según la dirección del primary confunde más que ayuda:
    // "en desc esperaba invertir el estado, no también el alfabético interno".
    expect(sortProjects(projects, "status", "asc").map((p) => p.id)).toEqual(["a", "c", "b"]);
    expect(sortProjects(projects, "status", "desc").map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("sort by key uses the project key as string", () => {
    expect(sortProjects(projects, "key", "asc").map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(sortProjects(projects, "key", "desc").map((p) => p.id)).toEqual(["c", "b", "a"]);
  });

  it("does not mutate the input array", () => {
    const original = [...projects];
    sortProjects(projects, "name", "desc");
    expect(projects).toEqual(original);
  });
});

describe("canToggleActive", () => {
  it("lets admin toggle anything", () => {
    expect(canToggleActive(true, "someone-else", "me")).toBe(true);
    expect(canToggleActive(true, null, "me")).toBe(true);
  });

  it("lets the primary PM toggle their own project", () => {
    expect(canToggleActive(false, "me", "me")).toBe(true);
  });

  it("blocks non-admin, non-PM", () => {
    expect(canToggleActive(false, "someone-else", "me")).toBe(false);
    expect(canToggleActive(false, null, "me")).toBe(false);
    expect(canToggleActive(false, undefined, "me")).toBe(false);
  });
});
