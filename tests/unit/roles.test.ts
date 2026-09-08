import { describe, expect, it } from "vitest";

import {
  ROLE_ORDER,
  formatRoles,
  hasAnyRole,
  hasRole,
  isAdmin,
  isDeveloper,
  isPm,
  sortRoles,
} from "@/lib/auth/roles";
import { sortDevsByPrimaryPm } from "@/lib/bookings/options";
import { canCreateBookings, canManageProject } from "@/lib/bookings/permissions";

/**
 * T4.1 — feature 012. Los roles pasaron de un valor a un conjunto (D-09), así
 * que lo que hay que probar no es que las funciones anden: es que **el caso de
 * dos roles** se comporte como corresponde en cada lugar donde antes había un
 * `===`.
 */
describe("roles", () => {
  it("answers membership, not equality", () => {
    expect(hasRole(["pm", "admin"], "admin")).toBe(true);
    expect(hasRole(["pm", "admin"], "developer")).toBe(false);
    expect(hasRole([], "admin")).toBe(false);
    expect(hasRole(null, "admin")).toBe(false);
    expect(hasRole(undefined, "admin")).toBe(false);
  });

  it("recognises each role independently of the others", () => {
    const both = ["pm", "admin"] as const;
    expect(isAdmin([...both])).toBe(true);
    expect(isPm([...both])).toBe(true);
    expect(isDeveloper([...both])).toBe(false);
  });

  it("tells 'not provisioned yet' from 'has no admin'", () => {
    // El conjunto vacío es el estado de quien espera en /pending-access, y es
    // distinto de tener roles que no incluyen el que se pregunta (AC-1.5).
    expect(hasAnyRole([])).toBe(false);
    expect(hasAnyRole(["developer"])).toBe(true);
    expect(isAdmin(["developer"])).toBe(false);
  });

  it("sorts and dedupes like the database trigger", () => {
    expect(sortRoles(["developer", "admin"])).toEqual(["admin", "developer"]);
    expect(sortRoles(["pm", "pm"])).toEqual(["pm"]);
    expect(sortRoles([...ROLE_ORDER].reverse())).toEqual([...ROLE_ORDER]);
  });

  it("formats with the UI vocabulary, never the database's", () => {
    expect(formatRoles(["pm", "admin"])).toBe("Admin · PM");
    expect(formatRoles(["developer"])).toBe("Developer");
    expect(formatRoles([])).toBeNull();
    expect(formatRoles(null)).toBeNull();
  });
});

/**
 * El motivo por el que D-09 existía, escrito como test: alguien que es PM *y*
 * admin tiene que poder las dos cosas. Con `profiles.role` singular este caso no
 * se podía ni construir.
 */
describe("permissions with more than one role", () => {
  const someoneElsesProject = { pmId: "otro-pm" };
  const ownProject = { pmId: "yo" };

  it("lets a pm+admin manage a project that belongs to another PM", () => {
    expect(canManageProject({ id: "yo", roles: ["pm", "admin"] }, someoneElsesProject)).toBe(true);
  });

  it("does not let a plain pm manage the same project", () => {
    expect(canManageProject({ id: "yo", roles: ["pm"] }, someoneElsesProject)).toBe(false);
  });

  it("still lets a plain pm manage their own", () => {
    expect(canManageProject({ id: "yo", roles: ["pm"] }, ownProject)).toBe(true);
  });

  it("gives a developer+pm the create action, and a plain developer none", () => {
    expect(canCreateBookings({ id: "yo", roles: ["developer", "pm"] })).toBe(true);
    expect(canCreateBookings({ id: "yo", roles: ["developer"] })).toBe(false);
  });

  it("gives nothing to an empty set", () => {
    expect(canCreateBookings({ id: "yo", roles: [] })).toBe(false);
    expect(canManageProject({ id: "yo", roles: [] }, ownProject)).toBe(false);
    expect(canManageProject(null, ownProject)).toBe(false);
  });
});

/**
 * T4.1 — feature 013 / D-03. AC-3.2 de `002` pedía dos cosas y solo se había
 * hecho una: la columna existía y se editaba, pero ningún código la leía.
 */
describe("sortDevsByPrimaryPm", () => {
  const devs = [
    { id: "ana", primaryPmId: "otro-pm" },
    { id: "beto", primaryPmId: "pm-1" },
    { id: "caro", primaryPmId: null },
    { id: "dani", primaryPmId: "pm-1" },
  ];

  it("puts the viewer's own developers first, keeping the incoming order", () => {
    const sorted = sortDevsByPrimaryPm(devs, { id: "pm-1", isAdmin: false });

    expect(sorted.map((dev) => dev.id)).toEqual(["beto", "dani", "ana", "caro"]);
  });

  it("hides nobody — it is an order, not a filter", () => {
    // AC-2.3, y es la mitad que importa: el AC original dice "candidato
    // natural", no "único candidato", y Q-B ya dijo que el dev es transversal.
    const sorted = sortDevsByPrimaryPm(devs, { id: "pm-1", isAdmin: false });

    expect(sorted).toHaveLength(devs.length);
    expect(new Set(sorted.map((dev) => dev.id))).toEqual(new Set(devs.map((dev) => dev.id)));
  });

  it("leaves the list alone for a PM who has no developers of their own", () => {
    const sorted = sortDevsByPrimaryPm(devs, { id: "pm-sin-devs", isAdmin: false });

    expect(sorted.map((dev) => dev.id)).toEqual(devs.map((dev) => dev.id));
  });

  it("does not reorder for an admin", () => {
    // AC-2.2: no tiene devs propios, y un orden que cambia según quién mira sin
    // que nada lo anuncie es peor que el alfabético.
    const sorted = sortDevsByPrimaryPm(devs, { id: "pm-1", isAdmin: true });

    expect(sorted.map((dev) => dev.id)).toEqual(devs.map((dev) => dev.id));
  });
});
