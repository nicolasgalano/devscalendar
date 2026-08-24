import { describe, expect, it } from "vitest";

import {
  canCancel,
  canEdit,
  isReschedule,
  nextStatusAfterEdit,
  type BookingSnapshot,
} from "@/lib/bookings/transitions";
import { createBookingSchema, updateBookingSchema } from "@/lib/validation/bookings";

const approved: BookingSnapshot = {
  status: "approved",
  devId: "dev-1",
  startsAt: "2026-08-05T12:00:00.000Z",
  endsAt: "2026-08-05T16:00:00.000Z",
};

describe("isReschedule", () => {
  it("is true when the slot moves", () => {
    expect(isReschedule(approved, { startsAt: "2026-08-05T13:00:00.000Z" })).toBe(true);
    expect(isReschedule(approved, { endsAt: "2026-08-05T18:00:00.000Z" })).toBe(true);
  });

  it("is true when the developer changes", () => {
    expect(isReschedule(approved, { devId: "dev-2" })).toBe(true);
  });

  it("is false for note and ticket", () => {
    expect(isReschedule(approved, { note: "otra nota", ticketRef: "WEB-9" })).toBe(false);
  });

  it("is false when the same values are sent again", () => {
    expect(
      isReschedule(approved, { devId: "dev-1", startsAt: approved.startsAt }),
    ).toBe(false);
  });

  // El formulario manda el horario completo en cada guardado; si la comparación
  // fuera textual, "12:00:00.000Z" y "12:00:00Z" contarían como un cambio y
  // mandarían a re-aprobar una reserva que nadie movió.
  it("compares instants, not strings", () => {
    expect(isReschedule(approved, { startsAt: "2026-08-05T12:00:00Z" })).toBe(false);
  });
});

describe("nextStatusAfterEdit", () => {
  // Q-E, respondida por el cliente el 2026-08-06.
  it("sends an approved booking back to pending when it is rescheduled", () => {
    expect(nextStatusAfterEdit(approved, { startsAt: "2026-08-05T13:00:00Z" })).toBe(
      "pending",
    );
    expect(nextStatusAfterEdit(approved, { devId: "dev-2" })).toBe("pending");
  });

  it("keeps the approval when only note or ticket change", () => {
    expect(nextStatusAfterEdit(approved, { note: "corrijo la nota" })).toBe("approved");
    expect(nextStatusAfterEdit(approved, { ticketRef: "WEB-9" })).toBe("approved");
  });

  it("leaves a pending booking pending: there is no approval to invalidate", () => {
    const pending = { ...approved, status: "pending" as const };
    expect(nextStatusAfterEdit(pending, { startsAt: "2026-08-05T13:00:00Z" })).toBe(
      "pending",
    );
  });
});

describe("canCancel / canEdit", () => {
  it("allows cancelling a live booking", () => {
    expect(canCancel("pending")).toBe(true);
    expect(canCancel("approved")).toBe(true);
    expect(canCancel("rejected")).toBe(true);
  });

  it("refuses to cancel what is already terminal", () => {
    expect(canCancel("cancelled")).toBe(false);
    expect(canCancel("displaced")).toBe(false);
  });

  it("only allows editing while the booking is live", () => {
    expect(canEdit("pending")).toBe(true);
    expect(canEdit("approved")).toBe(true);
    // Una rechazada no se edita: el PM reasigna, y eso es una reserva nueva.
    expect(canEdit("rejected")).toBe(false);
    expect(canEdit("cancelled")).toBe(false);
    expect(canEdit("displaced")).toBe(false);
  });
});

describe("createBookingSchema", () => {
  const valid = {
    projectId: "00000000-0000-4000-8000-000000000041",
    devId: "00000000-0000-4000-8000-000000000021",
    startsAt: "2026-08-05T12:00:00Z",
    endsAt: "2026-08-05T16:00:00Z",
  };

  it("accepts a well-formed booking", () => {
    expect(createBookingSchema.safeParse(valid).success).toBe(true);
  });

  // AC-1.3
  it("rejects a booking that ends before it starts", () => {
    expect(
      createBookingSchema.safeParse({ ...valid, endsAt: "2026-08-05T10:00:00Z" }).success,
    ).toBe(false);
  });

  it("rejects a zero-length booking", () => {
    expect(
      createBookingSchema.safeParse({ ...valid, endsAt: valid.startsAt }).success,
    ).toBe(false);
  });

  /**
   * AC-1.4 / Q-G: fuera de horario y días no laborables se advierten en la UI,
   * nunca se bloquean. Si el schema los rechazara, la advertencia se volvería
   * un error y el sábado excepcional sería imposible de registrar.
   */
  it("accepts a Saturday booking outside working hours", () => {
    const saturdayNight = {
      ...valid,
      startsAt: "2026-08-08T23:00:00Z",
      endsAt: "2026-08-09T02:00:00Z",
    };
    expect(createBookingSchema.safeParse(saturdayNight).success).toBe(true);
  });

  it("turns an emptied note into null instead of an empty string", () => {
    const parsed = createBookingSchema.parse({ ...valid, note: "" });
    expect(parsed.note).toBeNull();
  });
});

describe("updateBookingSchema", () => {
  it("rejects an empty payload", () => {
    expect(updateBookingSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a single field", () => {
    expect(updateBookingSchema.safeParse({ note: "solo la nota" }).success).toBe(true);
  });

  it("checks the order only when both ends travel together", () => {
    expect(
      updateBookingSchema.safeParse({
        startsAt: "2026-08-05T16:00:00Z",
        endsAt: "2026-08-05T12:00:00Z",
      }).success,
    ).toBe(false);
    // Con un solo extremo el schema no puede juzgar: lo resuelve el handler
    // contra la fila actual.
    expect(updateBookingSchema.safeParse({ endsAt: "2026-08-05T12:00:00Z" }).success).toBe(
      true,
    );
  });

  // Aprobar y rechazar son del desarrollador (005), y el trigger de la base lo
  // hace cumplir aunque alguien saltee la API.
  it("only accepts 'cancelled' as an incoming status", () => {
    expect(updateBookingSchema.safeParse({ status: "cancelled" }).success).toBe(true);
    expect(updateBookingSchema.safeParse({ status: "approved" }).success).toBe(false);
  });
});
