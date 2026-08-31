import { describe, expect, it } from "vitest";

import { DEFAULT_STATUSES, hasActiveFilters, parseCalendarParams } from "@/lib/validation/calendar";

const today = "2026-08-05";
const parse = (raw: Record<string, string | string[] | undefined>) =>
  parseCalendarParams(raw, { today });

const CLIENT = "00000000-0000-4000-8000-000000000031";

describe("parseCalendarParams", () => {
  it("falls back to the defaults on an empty query string", () => {
    expect(parse({})).toEqual({
      view: "month",
      date: today,
      group: "dev",
      filters: {
        clientId: null,
        projectId: null,
        devId: null,
        pmId: null,
        statuses: [...DEFAULT_STATUSES],
        priority: null,
      },
    });
  });

  it("reads a well-formed query string", () => {
    const params = parse({
      view: "day",
      date: "2026-12-24",
      group: "project",
      client: CLIENT,
      priority: "high",
      status: "approved,rejected",
    });

    expect(params.view).toBe("day");
    expect(params.date).toBe("2026-12-24");
    expect(params.group).toBe("project");
    expect(params.filters.clientId).toBe(CLIENT);
    expect(params.filters.priority).toBe("high");
    expect(params.filters.statuses).toEqual(["approved", "rejected"]);
  });

  // A mangled or stale URL must never 404 the main screen of the product.
  it("never throws on garbage", () => {
    const params = parse({
      view: "decade",
      date: "2026-13-45",
      group: "planet",
      client: "not-a-uuid",
      priority: "urgentísimo",
      status: "inventado",
    });

    expect(params).toEqual({
      view: "month",
      date: today,
      group: "dev",
      filters: {
        clientId: null,
        projectId: null,
        devId: null,
        pmId: null,
        statuses: [...DEFAULT_STATUSES],
        priority: null,
      },
    });
  });

  it("rejects a date that matches the shape but does not exist", () => {
    expect(parse({ date: "2026-02-30" }).date).toBe(today);
    expect(parse({ date: "2028-02-29" }).date).toBe("2028-02-29"); // bisiesto real
  });

  it("keeps the valid statuses and drops the rest", () => {
    expect(parse({ status: "approved,inventado,pending" }).filters.statuses).toEqual([
      "approved",
      "pending",
    ]);
  });

  it("de-duplicates repeated statuses", () => {
    expect(parse({ status: "approved,approved" }).filters.statuses).toEqual(["approved"]);
  });

  it("takes the first value when a param is repeated", () => {
    expect(parse({ view: ["day", "year"] }).view).toBe("day");
  });
});

describe("hasActiveFilters", () => {
  it("is false for the defaults", () => {
    expect(hasActiveFilters(parse({}).filters)).toBe(false);
  });

  it("is true when any filter narrows the view", () => {
    expect(hasActiveFilters(parse({ client: CLIENT }).filters)).toBe(true);
    expect(hasActiveFilters(parse({ priority: "high" }).filters)).toBe(true);
    expect(hasActiveFilters(parse({ status: "cancelled" }).filters)).toBe(true);
  });

  // La lista se arma desde `DEFAULT_STATUSES` y se desordena, en vez de
  // escribirla a mano: así el test prueba que el orden no importa y no queda
  // atado a *cuáles* son los estados por default, que ya cambiaron una vez
  // (`005` sumó `rejected` — ver F7).
  it("ignores the order of the status list", () => {
    const shuffled = [...DEFAULT_STATUSES].reverse().join(",");
    expect(hasActiveFilters(parse({ status: shuffled }).filters)).toBe(false);
  });
});
