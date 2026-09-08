import { describe, expect, it } from "vitest";

import {
  buildPlanningMatrix,
  computeDevDayLoad,
  isOverloaded,
  overloadContributions,
  splitBookingByDay,
} from "@/lib/calendar/planning";
import type { CalendarBooking } from "@/lib/calendar/query";

const AR = "America/Argentina/Buenos_Aires";
const MADRID = "Europe/Madrid";

/** Wall clock in Buenos Aires as a UTC instant — same trick as load.test. */
const on = (day: string, hour: number) =>
  new Date(Date.parse(`2026-08-${day}T03:00:00Z`) + hour * 3_600_000).toISOString();

type BookingSeed = {
  id: string;
  clientId?: string;
  clientName?: string;
  projectId?: string;
  projectName?: string;
  projectPriority?: "high" | "normal";
  devId?: string;
  devName?: string;
  status?: CalendarBooking["status"];
  startsAt: string;
  endsAt: string;
};

function booking(seed: BookingSeed): CalendarBooking {
  return {
    id: seed.id,
    startsAt: seed.startsAt,
    endsAt: seed.endsAt,
    updatedAt: seed.startsAt,
    status: seed.status ?? "approved",
    note: null,
    ticketRef: null,
    dev: { id: seed.devId ?? "dev-1", name: seed.devName ?? "Emi" },
    project: {
      id: seed.projectId ?? "proj-1",
      name: seed.projectName ?? "Proyecto X",
      priority: seed.projectPriority ?? "normal",
      pmId: "pm-1",
      client: {
        id: seed.clientId ?? "client-1",
        name: seed.clientName ?? "Cliente A",
      },
    },
  };
}

describe("splitBookingByDay", () => {
  it("attributes an intra-day booking to a single day", () => {
    const shares = splitBookingByDay(
      { startsAt: on("05", 9), endsAt: on("05", 13) },
      AR,
    );
    expect(shares).toEqual([{ isoDate: "2026-08-05", minutes: 240 }]);
  });

  it("splits a 22:00–02:00 booking across both days", () => {
    // 22:00 del 5 → 02:00 del 6, hora local.
    const shares = splitBookingByDay(
      { startsAt: on("05", 22), endsAt: on("06", 2) },
      AR,
    );
    expect(shares).toEqual([
      { isoDate: "2026-08-05", minutes: 120 },
      { isoDate: "2026-08-06", minutes: 120 },
    ]);
  });

  it("splits a booking that spans three calendar days", () => {
    // 23:00 del 5 → 08:00 del 7 local = 1 h + 24 h + 8 h = 33 h.
    const shares = splitBookingByDay(
      { startsAt: on("05", 23), endsAt: on("07", 8) },
      AR,
    );
    expect(shares).toEqual([
      { isoDate: "2026-08-05", minutes: 60 },
      { isoDate: "2026-08-06", minutes: 24 * 60 },
      { isoDate: "2026-08-07", minutes: 8 * 60 },
    ]);
  });

  it("uses the local day boundary, not the UTC one", () => {
    // Madrid en enero es UTC+1: 23:30 del día 5 local es 22:30 UTC.
    // Un booking 23:30 → 00:30 local (una hora) tiene que dividirse por día
    // local, no por medianoche UTC.
    const shares = splitBookingByDay(
      { startsAt: "2026-01-05T22:30:00Z", endsAt: "2026-01-05T23:30:00Z" },
      MADRID,
    );
    expect(shares).toEqual([
      { isoDate: "2026-01-05", minutes: 30 },
      { isoDate: "2026-01-06", minutes: 30 },
    ]);
  });

  it("ignores a zero- or negative-duration booking", () => {
    expect(
      splitBookingByDay({ startsAt: on("05", 9), endsAt: on("05", 9) }, AR),
    ).toEqual([]);
    expect(
      splitBookingByDay({ startsAt: on("05", 10), endsAt: on("05", 9) }, AR),
    ).toEqual([]);
  });
});

describe("buildPlanningMatrix", () => {
  const days = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];

  it("groups one row per (client, project, dev), sorted alphabetically", () => {
    const rows = buildPlanningMatrix(
      [
        booking({
          id: "a",
          clientId: "c-b",
          clientName: "Cliente B",
          projectId: "p-z",
          projectName: "Proyecto Z",
          devId: "dev-cris",
          devName: "Cris",
          startsAt: on("04", 9),
          endsAt: on("04", 12),
        }),
        booking({
          id: "b",
          clientId: "c-a",
          clientName: "Cliente A",
          projectId: "p-x",
          projectName: "Proyecto X",
          devId: "dev-emi",
          devName: "Emi",
          startsAt: on("05", 9),
          endsAt: on("05", 15),
        }),
      ],
      days,
      AR,
    );

    expect(rows.map((row) => [row.client.name, row.project.name, row.dev.name])).toEqual([
      ["Cliente A", "Proyecto X", "Emi"],
      ["Cliente B", "Proyecto Z", "Cris"],
    ]);
  });

  it("splits the same combination across days into separate cells", () => {
    const rows = buildPlanningMatrix(
      [
        booking({ id: "a", startsAt: on("04", 9), endsAt: on("04", 13) }),
        booking({ id: "b", startsAt: on("05", 10), endsAt: on("05", 12) }),
      ],
      days,
      AR,
    );

    expect(rows).toHaveLength(1);
    const cells = rows[0]!.cells;
    expect(cells.get("2026-08-04")).toMatchObject({ hoursApproved: 4, hoursPending: 0 });
    expect(cells.get("2026-08-05")).toMatchObject({ hoursApproved: 2, hoursPending: 0 });
  });

  it("keeps approved and pending hours separate on the same cell", () => {
    const rows = buildPlanningMatrix(
      [
        booking({
          id: "a",
          status: "approved",
          startsAt: on("05", 9),
          endsAt: on("05", 13),
        }),
        booking({
          id: "b",
          status: "pending",
          startsAt: on("05", 14),
          endsAt: on("05", 17),
        }),
      ],
      days,
      AR,
    );

    const cell = rows[0]!.cells.get("2026-08-05")!;
    expect(cell.hoursApproved).toBe(4);
    expect(cell.hoursPending).toBe(3);
    expect(cell.bookingIds).toEqual(["a", "b"]);
  });

  it("lists displaced bookings in bookingIds but excludes them from hours", () => {
    const rows = buildPlanningMatrix(
      [
        booking({
          id: "a",
          status: "approved",
          startsAt: on("05", 9),
          endsAt: on("05", 13),
        }),
        booking({
          id: "b",
          status: "displaced",
          startsAt: on("05", 14),
          endsAt: on("05", 17),
        }),
      ],
      days,
      AR,
    );

    const cell = rows[0]!.cells.get("2026-08-05")!;
    expect(cell.hoursApproved).toBe(4);
    expect(cell.hoursPending).toBe(0);
    expect(cell.bookingIds).toContain("b");
  });

  it("ignores rejected and cancelled bookings entirely", () => {
    const rows = buildPlanningMatrix(
      [
        booking({ id: "a", status: "rejected", startsAt: on("05", 9), endsAt: on("05", 13) }),
        booking({ id: "b", status: "cancelled", startsAt: on("05", 14), endsAt: on("05", 17) }),
      ],
      days,
      AR,
    );
    expect(rows).toEqual([]);
  });

  it("skips days that fall outside the visible window", () => {
    const rows = buildPlanningMatrix(
      [
        // 2026-08-10 no está en `days`.
        booking({ id: "a", startsAt: on("10", 9), endsAt: on("10", 13) }),
        booking({ id: "b", startsAt: on("05", 9), endsAt: on("05", 13) }),
      ],
      days,
      AR,
    );

    // La reserva del 10 se descarta y su combinación sigue apareciendo por la
    // otra reserva. Si hubiera sido la única, la fila no existiría.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells.has("2026-08-10")).toBe(false);
  });
});

describe("computeDevDayLoad", () => {
  const days = ["2026-08-05", "2026-08-06"];

  it("sums a dev's hours across projects", () => {
    const loads = computeDevDayLoad(
      [
        { devId: "dev-1", projectId: "p", projectName: "P",
          startsAt: on("05", 9), endsAt: on("05", 13) },
        { devId: "dev-1", projectId: "p", projectName: "P",
          startsAt: on("05", 14), endsAt: on("05", 19) },
      ],
      days,
      AR,
    );
    expect(loads.get("dev-1::2026-08-05")).toBe(9);
  });

  it("keeps different devs on different keys", () => {
    const loads = computeDevDayLoad(
      [
        { devId: "dev-1", projectId: "p", projectName: "P",
          startsAt: on("05", 9), endsAt: on("05", 17) },
        { devId: "dev-2", projectId: "p", projectName: "P",
          startsAt: on("05", 9), endsAt: on("05", 12) },
      ],
      days,
      AR,
    );
    expect(loads.get("dev-1::2026-08-05")).toBe(8);
    expect(loads.get("dev-2::2026-08-05")).toBe(3);
  });

  it("distributes a cross-midnight booking to both days", () => {
    const loads = computeDevDayLoad(
      [
        { devId: "dev-1", projectId: "p", projectName: "P",
          startsAt: on("05", 22), endsAt: on("06", 2) },
      ],
      days,
      AR,
    );
    expect(loads.get("dev-1::2026-08-05")).toBe(2);
    expect(loads.get("dev-1::2026-08-06")).toBe(2);
  });
});

describe("isOverloaded", () => {
  it("treats exactly 8h as not overloaded", () => {
    // Q-P1: strict `>8h`. 09–17 son 8 h netas y no es sobrecarga.
    expect(isOverloaded(8)).toBe(false);
    expect(isOverloaded(7.99)).toBe(false);
  });

  it("marks anything above 8h as overloaded", () => {
    expect(isOverloaded(8.01)).toBe(true);
    expect(isOverloaded(9)).toBe(true);
  });

  it("treats undefined (no bookings that day) as not overloaded", () => {
    expect(isOverloaded(undefined)).toBe(false);
  });
});

describe("overloadContributions", () => {
  it("orders projects by hours descending and skips other devs", () => {
    // `DevDayLoadRow[]` viene de `getDevDayLoad`, que ya excluye rejected /
    // cancelled / displaced (status in approved, pending). Acá se prueba el
    // agrupamiento, no la exclusión — que vive en la query.
    const rows = overloadContributions(
      "dev-1",
      "2026-08-05",
      [
        { devId: "dev-1", projectId: "p1", projectName: "Alfa",
          startsAt: on("05", 9), endsAt: on("05", 12) },
        { devId: "dev-1", projectId: "p2", projectName: "Beta",
          startsAt: on("05", 13), endsAt: on("05", 19) },
        // Otro dev — no cuenta.
        { devId: "dev-2", projectId: "p3", projectName: "Gamma",
          startsAt: on("05", 9), endsAt: on("05", 15) },
      ],
      AR,
    );

    expect(rows).toEqual([
      { projectId: "p2", projectName: "Beta", hours: 6 },
      { projectId: "p1", projectName: "Alfa", hours: 3 },
    ]);
  });
});
