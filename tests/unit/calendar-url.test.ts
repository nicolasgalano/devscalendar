import { describe, expect, it } from "vitest";

import { calendarHref, clearFiltersHref } from "@/lib/calendar/url";
import {
  DEFAULT_STATUSES,
  parseCalendarParams,
  type CalendarParams,
} from "@/lib/validation/calendar";

const today = "2026-08-05";

/** Base state: nothing narrowed, defaults everywhere. */
function baseParams(): CalendarParams {
  return {
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
      includePms: false,
    },
  };
}

/** Extracts the query-string half of an href built by `calendarHref`. */
function query(href: string): Record<string, string> {
  const url = new URL(href, "http://x");
  return Object.fromEntries(url.searchParams);
}

describe("calendarHref + includePms", () => {
  it("does not write the default (false) to the URL", () => {
    const href = calendarHref(baseParams());
    expect(query(href).includePms).toBeUndefined();
  });

  it("writes includePms=1 when true", () => {
    const href = calendarHref(baseParams(), { filters: { includePms: true } });
    expect(query(href).includePms).toBe("1");
  });

  // Round trip: URL → params → URL preserva el toggle sin escribir defaults.
  it("round-trips includePms=true", () => {
    const href = calendarHref(baseParams(), { filters: { includePms: true } });
    const parsed = parseCalendarParams(query(href), { today });
    expect(parsed.filters.includePms).toBe(true);
  });

  it("clearFiltersHref turns includePms back off", () => {
    const withPms = { ...baseParams(), filters: { ...baseParams().filters, includePms: true } };
    const cleared = clearFiltersHref(withPms);
    expect(query(cleared).includePms).toBeUndefined();
    expect(parseCalendarParams(query(cleared), { today }).filters.includePms).toBe(false);
  });
});
