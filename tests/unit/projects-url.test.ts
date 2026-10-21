import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROJECTS_URL,
  nextSortDir,
  parseProjectsUrl,
  projectsHref,
  type ProjectsListUrl,
} from "@/lib/projects/url";

/**
 * Feature 028 — T2.3. El parser nunca tira; el serializer nunca escribe
 * defaults; el round-trip es estable para cualquier URL válida.
 */

function query(href: string): Record<string, string> {
  const url = new URL(href, "http://x");
  return Object.fromEntries(url.searchParams);
}

function sp(record: Record<string, string>): URLSearchParams {
  return new URLSearchParams(record);
}

describe("parseProjectsUrl", () => {
  it("returns defaults for an empty search", () => {
    expect(parseProjectsUrl(sp({}))).toEqual(DEFAULT_PROJECTS_URL);
  });

  it("trims whitespace in q but preserves content", () => {
    expect(parseProjectsUrl(sp({ q: "  foo  " })).q).toBe("foo");
  });

  it("falls back to defaults on invalid values — never throws", () => {
    const parsed = parseProjectsUrl(
      sp({ sort: "garbage", dir: "sideways", active: "maybe" }),
    );
    expect(parsed).toEqual(DEFAULT_PROJECTS_URL);
  });

  it("accepts every valid value", () => {
    const parsed = parseProjectsUrl(
      sp({ q: "arg", active: "all", sort: "client", dir: "desc" }),
    );
    expect(parsed).toEqual({ q: "arg", active: "all", sort: "client", dir: "desc" });
  });
});

describe("projectsHref", () => {
  it("omits every default — the base URL is just /projects", () => {
    expect(projectsHref(DEFAULT_PROJECTS_URL)).toBe("/projects");
  });

  it("writes only the fields that differ from defaults", () => {
    const href = projectsHref(DEFAULT_PROJECTS_URL, { q: "foo" });
    expect(query(href)).toEqual({ q: "foo" });
  });

  it("writes active=all but omits active=on", () => {
    expect(query(projectsHref(DEFAULT_PROJECTS_URL, { active: "all" }))).toEqual({
      active: "all",
    });
    expect(query(projectsHref(DEFAULT_PROJECTS_URL, { active: "on" }))).toEqual({});
  });

  it("applies patch on top of current", () => {
    const current: ProjectsListUrl = {
      q: "foo",
      active: "all",
      sort: "client",
      dir: "desc",
    };
    const href = projectsHref(current, { sort: "pm" });
    expect(query(href)).toEqual({ q: "foo", active: "all", sort: "pm", dir: "desc" });
  });
});

describe("round-trip", () => {
  it("is stable for every canonical state", () => {
    const cases: ProjectsListUrl[] = [
      DEFAULT_PROJECTS_URL,
      { q: "foo", active: "all", sort: "client", dir: "desc" },
      { q: "", active: "all", sort: "status", dir: "asc" },
      { q: "ñandú", active: "on", sort: "pm", dir: "desc" },
    ];
    for (const original of cases) {
      const href = projectsHref(original);
      const url = new URL(href, "http://x");
      expect(parseProjectsUrl(url.searchParams)).toEqual(original);
    }
  });
});

describe("nextSortDir", () => {
  it("starts ascending when clicking a different column", () => {
    const current: ProjectsListUrl = { ...DEFAULT_PROJECTS_URL, sort: "name", dir: "desc" };
    expect(nextSortDir(current, "client")).toBe("asc");
  });

  it("flips when clicking the active column", () => {
    const asc: ProjectsListUrl = { ...DEFAULT_PROJECTS_URL, sort: "name", dir: "asc" };
    const desc: ProjectsListUrl = { ...DEFAULT_PROJECTS_URL, sort: "name", dir: "desc" };
    expect(nextSortDir(asc, "name")).toBe("desc");
    expect(nextSortDir(desc, "name")).toBe("asc");
  });
});
