import { describe, expect, it } from "vitest";

import { deriveFacets, type FacetRow } from "@/lib/calendar/facets";
import { DEFAULT_STATUSES, type CalendarFilters } from "@/lib/validation/calendar";

const noFilters: CalendarFilters = {
  clientId: null,
  projectId: null,
  devId: null,
  pmId: null,
  statuses: [...DEFAULT_STATUSES],
  priority: null,
};

const row = (
  dev: string,
  project: string,
  client: string,
  pm: string,
): FacetRow => ({
  devId: `dev-${dev}`,
  devName: dev,
  projectId: `proj-${project}`,
  projectName: project,
  clientId: `cli-${client}`,
  clientName: client,
  pmId: `pm-${pm}`,
  pmName: pm,
});

/**
 * Cristian works for Acme (Website) and Nimbus (Portal); Malena only for Acme.
 * Paula manages Website, Diego manages Portal.
 */
const rows: FacetRow[] = [
  row("Cristian", "Website", "Acme", "Paula"),
  row("Cristian", "Portal", "Nimbus", "Diego"),
  row("Malena", "Website", "Acme", "Paula"),
  row("Malena", "Website", "Acme", "Paula"), // repetida: dos reservas
];

describe("deriveFacets", () => {
  it("lists every entity present, without duplicates and sorted by name", () => {
    const facets = deriveFacets(rows, noFilters);

    expect(facets.devs.map((d) => d.name)).toEqual(["Cristian", "Malena"]);
    expect(facets.clients.map((c) => c.name)).toEqual(["Acme", "Nimbus"]);
    expect(facets.projects.map((p) => p.name)).toEqual(["Portal", "Website"]);
    expect(facets.pms.map((p) => p.name)).toEqual(["Diego", "Paula"]);
  });

  it("narrows the other facets to what the selected developer has", () => {
    const facets = deriveFacets(rows, { ...noFilters, devId: "dev-Malena" });

    // Malena solo tiene reservas de Acme / Website.
    expect(facets.clients.map((c) => c.name)).toEqual(["Acme"]);
    expect(facets.projects.map((p) => p.name)).toEqual(["Website"]);
    expect(facets.pms.map((p) => p.name)).toEqual(["Paula"]);
  });

  /**
   * La regla que hace usable el filtrado facetado: si la faceta de
   * desarrollador se calculara con su propio filtro puesto, quedaría una sola
   * opción y no habría forma de cambiar de dev sin limpiar todo.
   */
  it("does not narrow a facet by its own filter", () => {
    const facets = deriveFacets(rows, { ...noFilters, devId: "dev-Malena" });

    expect(facets.devs.map((d) => d.name)).toEqual(["Cristian", "Malena"]);
  });

  it("combines several filters, each facet ignoring only its own", () => {
    const facets = deriveFacets(rows, {
      ...noFilters,
      clientId: "cli-Acme",
      pmId: "pm-Paula",
    });

    // Cliente + PM dejan solo las filas de Website/Acme.
    expect(facets.devs.map((d) => d.name)).toEqual(["Cristian", "Malena"]);
    expect(facets.projects.map((p) => p.name)).toEqual(["Website"]);
    // Cada faceta se libera de su propio filtro, pero sigue sujeta al otro:
    // clientes se calcula sin `clientId` y con `pmId = Paula`, que solo existe
    // sobre Acme. Liberarse de todos los filtros sería volver al listado
    // completo y ofrecer combinaciones que no devuelven nada.
    expect(facets.clients.map((c) => c.name)).toEqual(["Acme"]);
    expect(facets.pms.map((p) => p.name)).toEqual(["Paula"]);
  });

  it("returns empty facets when the range has no bookings", () => {
    const facets = deriveFacets([], noFilters);

    expect(facets.clients).toEqual([]);
    expect(facets.devs).toEqual([]);
  });

  it("leaves a facet empty when the combination has no matches", () => {
    // Malena nunca trabajó para Nimbus.
    const facets = deriveFacets(rows, { ...noFilters, clientId: "cli-Nimbus", devId: "dev-Malena" });

    expect(facets.projects).toEqual([]);
    // Pero desarrollador y cliente siguen ofreciendo salidas, porque cada uno
    // ignora su propio filtro: se puede corregir la elección sin limpiar todo.
    expect(facets.devs.map((d) => d.name)).toEqual(["Cristian"]);
    expect(facets.clients.map((c) => c.name)).toEqual(["Acme"]);
  });
});
