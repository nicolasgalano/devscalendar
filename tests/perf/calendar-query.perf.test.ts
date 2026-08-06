import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getBookingsInRange } from "@/lib/calendar/query";
import { DEFAULT_STATUSES, type CalendarFilters } from "@/lib/validation/calendar";
import type { Database } from "@/types/database";

import {
  cleanupBookings,
  cleanupClient,
  cleanupProject,
  createBookingRows,
  createClientRow,
  createProjectRow,
  createUserWithRole,
  deleteTestUser,
  signInClient,
} from "../integration/helpers";

const password = "Test-password-123!";

/**
 * AC-4.2 asks for filtered results in under 500 ms over three months with fewer
 * than 500 bookings. That budget covers query, render and network; this measures
 * only the query, against the tighter budget the plan set for it (R-5).
 *
 * It lives in its own vitest project, outside `pnpm test`, on purpose: the
 * integration files run in parallel against a single local Postgres, and under
 * that contention the same query measured 372 ms instead of 69 ms. A timing
 * assertion competing with other tests measures the machine, not the product —
 * and a flaky performance gate is worse than none, because the first thing
 * anybody does with it is raise the number until it stops failing.
 *
 * Run with `pnpm test:perf`, with nothing else hitting the database.
 */
describe("calendar query performance", () => {
  const BUDGET_MS = 150;
  const TOTAL = 500;

  const noFilters: CalendarFilters = {
    clientId: null,
    projectId: null,
    devId: null,
    pmId: null,
    statuses: [...DEFAULT_STATUSES],
    priority: null,
  };

  let pm: { id: string; email: string };
  let dev: { id: string };
  let clientId: string;
  let projectId: string;
  let client: SupabaseClient<Database>;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const pmUser = await createUserWithRole(`perf-pm-${suffix}@example.com`, password, "pm");
    const devUser = await createUserWithRole(
      `perf-dev-${suffix}@example.com`,
      password,
      "developer",
    );
    pm = { id: pmUser.id, email: pmUser.email! };
    dev = { id: devUser.id };

    clientId = (await createClientRow(`Perf cliente ${suffix}`)).id;
    projectId = (
      await createProjectRow({ name: `Perf proyecto ${suffix}`, clientId, pmId: pm.id })
    ).id;

    // 500 bookings spread over three months.
    const base = Date.parse("2026-09-01T12:00:00Z");
    await createBookingRows(
      Array.from({ length: TOTAL }, (_, index) => {
        const start = base + Math.floor(index / 6) * 86_400_000 + (index % 6) * 3_600_000;
        return {
          projectId,
          devId: dev.id,
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(start + 3_600_000).toISOString(),
        };
      }),
    );

    client = await signInClient(pm.email, password);
  }, 60_000);

  afterAll(async () => {
    try {
      await cleanupBookings([projectId]);
      await cleanupProject(projectId);
      await cleanupClient(clientId);
    } finally {
      await deleteTestUser(pm.id);
      await deleteTestUser(dev.id);
    }
  });

  it(`reads three months of ${TOTAL} bookings within ${BUDGET_MS} ms`, async () => {
    const range = { from: "2026-09-01T00:00:00Z", to: "2026-12-01T00:00:00Z" };
    const filters = { ...noFilters, projectId };

    await getBookingsInRange(client, { range, filters }); // warm up

    const runs: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      const rows = await getBookingsInRange(client, { range, filters });
      runs.push(performance.now() - started);
      expect(rows.length).toBe(TOTAL);
    }

    runs.sort((a, b) => a - b);
    const median = runs[Math.floor(runs.length / 2)]!;
    console.log(
      `getBookingsInRange · ${TOTAL} reservas / 3 meses → mediana ${median.toFixed(0)} ms ` +
        `(min ${runs[0]!.toFixed(0)}, max ${runs.at(-1)!.toFixed(0)})`,
    );

    expect(median).toBeLessThan(BUDGET_MS);
  }, 60_000);
});
