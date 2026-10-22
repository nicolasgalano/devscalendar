import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLANNING_URL,
  parsePlanningUrl,
  planningHref,
  type PlanningUrl,
} from "@/lib/planning/url";

/**
 * Feature 029 — T2.9. Parser tolerante, serializer que no escribe
 * defaults. Mismo criterio de `src/lib/calendar/url.ts` y
 * `src/lib/projects/url.ts` (028).
 */

function sp(record: Record<string, string>): URLSearchParams {
  return new URLSearchParams(record);
}

function query(href: string): Record<string, string> {
  const url = new URL(href, "http://x");
  return Object.fromEntries(url.searchParams);
}

describe("parsePlanningUrl", () => {
  it("returns defaults for an empty search", () => {
    expect(parsePlanningUrl(sp({}))).toEqual(DEFAULT_PLANNING_URL);
  });

  it("accepts a valid project key and date", () => {
    expect(parsePlanningUrl(sp({ project: "PROJ", w: "2026-10-19" }))).toEqual({
      project: "PROJ",
      w: "2026-10-19",
    });
  });

  it("falls back to null for a malformed project key", () => {
    for (const bad of ["", "project-with-dashes", "foo lower", "1LEADING"]) {
      expect(parsePlanningUrl(sp({ project: bad })).project).toBeNull();
    }
  });

  it("falls back to null for a malformed date", () => {
    for (const bad of ["", "2026/10/19", "19-10-2026", "today"]) {
      expect(parsePlanningUrl(sp({ w: bad })).w).toBeNull();
    }
  });
});

describe("planningHref", () => {
  it("omits defaults — base URL is just /planning", () => {
    expect(planningHref(DEFAULT_PLANNING_URL)).toBe("/planning");
  });

  it("writes only non-default fields", () => {
    expect(query(planningHref(DEFAULT_PLANNING_URL, { project: "PROJ" }))).toEqual({
      project: "PROJ",
    });
    expect(query(planningHref(DEFAULT_PLANNING_URL, { w: "2026-10-19" }))).toEqual({
      w: "2026-10-19",
    });
  });

  it("applies patch on top of current", () => {
    const current: PlanningUrl = { project: "PROJ", w: "2026-10-19" };
    expect(query(planningHref(current, { w: null }))).toEqual({ project: "PROJ" });
  });
});

describe("round-trip", () => {
  it("is stable for every canonical state", () => {
    const cases: PlanningUrl[] = [
      DEFAULT_PLANNING_URL,
      { project: "PROJ", w: null },
      { project: null, w: "2026-10-19" },
      { project: "DEVS", w: "2026-10-19" },
    ];
    for (const original of cases) {
      const href = planningHref(original);
      const url = new URL(href, "http://x");
      expect(parsePlanningUrl(url.searchParams)).toEqual(original);
    }
  });
});
