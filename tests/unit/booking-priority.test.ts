import { describe, expect, it } from "vitest";

import {
  canDisplace,
  comparePendingBookings,
  describeDisplaceRefusal,
  explainDisplaceRefusal,
  outrankedByPending,
} from "@/lib/bookings/priority";
import { reallocateBookingSchema } from "@/lib/validation/bookings";

/** Lo mínimo de una reserva que miran el orden y el cruce de la bandeja. */
function pending(
  id: string,
  priority: "normal" | "high",
  startHour: number,
  endHour = startHour + 4,
) {
  const at = (hour: number) => new Date(Date.UTC(2026, 10, 16, hour)).toISOString();
  return { id, startsAt: at(startHour), endsAt: at(endHour), project: { priority } };
}

describe("canDisplace", () => {
  it("lets a priority project take a slot from a common one", () => {
    expect(canDisplace("high", "normal")).toBe(true);
  });

  it("refuses the other three cells of the matrix", () => {
    expect(canDisplace("normal", "high")).toBe(false);
    expect(canDisplace("normal", "normal")).toBe(false);
    expect(canDisplace("high", "high")).toBe(false);
  });
});

describe("explainDisplaceRefusal", () => {
  it("has no reason when the displacement is allowed", () => {
    expect(explainDisplaceRefusal("high", "normal")).toBeNull();
  });

  it("calls two priority projects a tie", () => {
    expect(explainDisplaceRefusal("high", "high")).toBe("tie");
  });

  it("does not call being outranked a tie", () => {
    // The PM of a common project has no standing in a negotiation between
    // priority projects: sending them there would be the wrong advice.
    expect(explainDisplaceRefusal("normal", "high")).toBe("insufficient");
    expect(explainDisplaceRefusal("normal", "normal")).toBe("insufficient");
  });
});

describe("describeDisplaceRefusal", () => {
  it("names who to talk to on a tie", () => {
    const message = describeDisplaceRefusal("tie", {
      projectName: "Rediseño checkout",
      pmName: "Lucía Fernández",
    });

    expect(message).toContain("Rediseño checkout");
    expect(message).toContain("Lucía Fernández");
  });

  it("falls back to a generic PM when the name is missing", () => {
    const message = describeDisplaceRefusal("tie", {
      projectName: "Rediseño checkout",
      pmName: null,
    });

    expect(message).toContain("su PM");
  });

  it("does not send an outranked PM to negotiate", () => {
    const message = describeDisplaceRefusal("insufficient", {
      projectName: "Rediseño checkout",
    });

    expect(message).toContain("Rediseño checkout");
    expect(message).not.toContain("Resolvelo");
  });
});

describe("reallocateBookingSchema", () => {
  const body = {
    projectId: "11111111-1111-4111-8111-111111111111",
    devId: "22222222-2222-4222-8222-222222222222",
    startsAt: "2026-09-07T12:00:00.000Z",
    endsAt: "2026-09-07T16:00:00.000Z",
    confirmedDisplacing: ["33333333-3333-4333-8333-333333333333"],
  };

  it("accepts an alta that names what it displaces", () => {
    expect(reallocateBookingSchema.safeParse(body).success).toBe(true);
  });

  it("refuses an empty list", () => {
    // Nothing to displace is the plain create path, not this one.
    const parsed = reallocateBookingSchema.safeParse({ ...body, confirmedDisplacing: [] });

    expect(parsed.success).toBe(false);
  });

  it("refuses a missing list", () => {
    // Optional would let it be dropped by accident, and the request would go
    // through displacing whatever happened to be there.
    const { confirmedDisplacing: _omitted, ...withoutList } = body;
    const parsed = reallocateBookingSchema.safeParse(withoutList);

    expect(parsed.success).toBe(false);
  });

  it("still refuses a booking that ends before it starts", () => {
    const parsed = reallocateBookingSchema.safeParse({
      ...body,
      endsAt: "2026-09-07T09:00:00.000Z",
    });

    expect(parsed.success).toBe(false);
  });

  it("does not know about the working day", () => {
    // Q-G: outside 09:00-17:00 is a warning in the UI, never a rejection here.
    const parsed = reallocateBookingSchema.safeParse({
      ...body,
      startsAt: "2026-09-07T23:00:00.000Z",
      endsAt: "2026-09-08T02:00:00.000Z",
    });

    expect(parsed.success).toBe(true);
  });
});

describe("comparePendingBookings", () => {
  it("puts a priority booking first even when it starts later", () => {
    // El caso que motiva todo (R-2): si el dev responde en orden de fecha,
    // aprueba primero la común y la prioritaria se queda sin franja.
    const common = pending("common", "normal", 9);
    const priority = pending("priority", "high", 14);

    expect([common, priority].sort(comparePendingBookings).map((b) => b.id)).toEqual([
      "priority",
      "common",
    ]);
  });

  it("falls back to the start time within the same priority", () => {
    const late = pending("late", "high", 14);
    const early = pending("early", "high", 9);

    expect([late, early].sort(comparePendingBookings).map((b) => b.id)).toEqual(["early", "late"]);
  });
});

describe("outrankedByPending", () => {
  it("flags a common booking that overlaps a pending priority one", () => {
    const common = pending("common", "normal", 9, 13);
    const priority = pending("priority", "high", 11, 15);

    const outranked = outrankedByPending([common, priority]);

    expect(outranked.has("common")).toBe(true);
    // La prioritaria no está en riesgo: es la que gana si se aprueba primero.
    expect(outranked.has("priority")).toBe(false);
  });

  it("does not flag bookings that merely touch", () => {
    // Mismo borde semiabierto que el constraint: 09:00-13:00 y 13:00-17:00 no
    // se superponen, así que aprobar una no le cuesta nada a la otra.
    const common = pending("common", "normal", 9, 13);
    const priority = pending("priority", "high", 13, 17);

    expect(outrankedByPending([common, priority]).size).toBe(0);
  });

  it("does not flag a common booking when nothing priority overlaps it", () => {
    const common = pending("common", "normal", 9, 13);
    const otherCommon = pending("other", "normal", 10, 14);
    const priority = pending("priority", "high", 20, 22);

    expect(outrankedByPending([common, otherCommon, priority]).size).toBe(0);
  });
});
