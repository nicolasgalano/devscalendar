import { describe, expect, it } from "vitest";

import {
  canCancel,
  canEdit,
  canRespond,
  explainBlockedAction,
  isReschedule,
  nextStatusAfterEdit,
  nextStatusAfterResponse,
  type BookingSnapshot,
} from "@/lib/bookings/transitions";
import {
  createBookingSchema,
  respondBookingSchema,
  updateBookingSchema,
} from "@/lib/validation/bookings";

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
    expect(isReschedule(approved, { devId: "dev-1", startsAt: approved.startsAt })).toBe(false);
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
    expect(nextStatusAfterEdit(approved, { startsAt: "2026-08-05T13:00:00Z" })).toBe("pending");
    expect(nextStatusAfterEdit(approved, { devId: "dev-2" })).toBe("pending");
  });

  it("keeps the approval when only note or ticket change", () => {
    expect(nextStatusAfterEdit(approved, { note: "corrijo la nota" })).toBe("approved");
    expect(nextStatusAfterEdit(approved, { ticketRef: "WEB-9" })).toBe("approved");
  });

  it("leaves a pending booking pending: there is no approval to invalidate", () => {
    const pending = { ...approved, status: "pending" as const };
    expect(nextStatusAfterEdit(pending, { startsAt: "2026-08-05T13:00:00Z" })).toBe("pending");
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
    expect(createBookingSchema.safeParse({ ...valid, endsAt: valid.startsAt }).success).toBe(false);
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
    expect(updateBookingSchema.safeParse({ endsAt: "2026-08-05T12:00:00Z" }).success).toBe(true);
  });

  // Aprobar y rechazar son del desarrollador (005), y el trigger de la base lo
  // hace cumplir aunque alguien saltee la API.
  it("only accepts 'cancelled' as an incoming status", () => {
    expect(updateBookingSchema.safeParse({ status: "cancelled" }).success).toBe(true);
    expect(updateBookingSchema.safeParse({ status: "approved" }).success).toBe(false);
  });
});

describe("canRespond / nextStatusAfterResponse", () => {
  // plan.md §3.3: responder es un acto sobre una reserva que sigue pendiente.
  it("only lets a pending booking be answered", () => {
    expect(canRespond("pending")).toBe(true);
    expect(canRespond("approved")).toBe(false);
    expect(canRespond("rejected")).toBe(false);
    expect(canRespond("cancelled")).toBe(false);
    expect(canRespond("displaced")).toBe(false);
  });

  it("lands on the answer the developer gave", () => {
    expect(nextStatusAfterResponse("pending", "approved")).toBe("approved");
    expect(nextStatusAfterResponse("pending", "rejected")).toBe("rejected");
  });

  /**
   * Las dos vueltas atrás que `plan.md` §3.3 descarta: desdecirse de una
   * aprobación es una conversación con el PM (F3), y una rechazada pasa a
   * "nueva reserva" según la spec funcional §5.2, no de vuelta a pendiente.
   */
  it("refuses to re-answer a booking that was already answered", () => {
    expect(nextStatusAfterResponse("approved", "rejected")).toBeNull();
    expect(nextStatusAfterResponse("rejected", "approved")).toBeNull();
  });

  it("refuses to answer a booking that is no longer live", () => {
    expect(nextStatusAfterResponse("cancelled", "approved")).toBeNull();
    expect(nextStatusAfterResponse("displaced", "approved")).toBeNull();
  });
});

describe("explainBlockedAction", () => {
  it("names the state and the action it refused", () => {
    expect(explainBlockedAction("respond", "approved")).toBe(
      "Una reserva aprobada no se puede responder",
    );
    expect(explainBlockedAction("cancel", "cancelled")).toBe(
      "Una reserva cancelada no se puede cancelar",
    );
    expect(explainBlockedAction("edit", "rejected")).toBe(
      "Una reserva rechazada no se puede editar",
    );
  });
});

describe("respondBookingSchema", () => {
  const valid = {
    status: "approved" as const,
    expectedUpdatedAt: "2026-08-26T12:34:56.789123+00:00",
  };

  /**
   * El caso central de la feature, acordado con el usuario el 2026-08-12: un
   * rechazo sin motivo deja al PM sin nada que hacer salvo preguntar por otro
   * canal, que es justo lo que la app viene a evitar. Aprobar, en cambio, no
   * necesita explicación — el sí ya dice todo.
   */
  it("demands a comment to reject, and none to approve", () => {
    expect(respondBookingSchema.safeParse({ ...valid, status: "rejected" }).success).toBe(false);
    expect(
      respondBookingSchema.safeParse({
        ...valid,
        status: "rejected",
        note: "Esa semana estoy con el release",
      }).success,
    ).toBe(true);
    expect(respondBookingSchema.safeParse(valid).success).toBe(true);
  });

  // `optionalText` recorta antes de decidir, así que el obligatorio no se
  // satisface con una barra espaciadora.
  it("does not accept whitespace as a reason", () => {
    expect(
      respondBookingSchema.safeParse({ ...valid, status: "rejected", note: "   " }).success,
    ).toBe(false);
  });

  it("accepts an optional comment when approving", () => {
    const parsed = respondBookingSchema.parse({ ...valid, note: "Lo tomo, pero justo" });
    expect(parsed.note).toBe("Lo tomo, pero justo");
  });

  /**
   * `expectedUpdatedAt` viaja tal cual lo devuelve PostgREST, con microsegundos
   * y offset `+00:00`. Si el schema no aceptara ese formato, la bandeja fallaría
   * con un 400 en cada respuesta y el motivo sería invisible.
   */
  it("accepts the timestamp format PostgREST returns", () => {
    expect(respondBookingSchema.safeParse(valid).success).toBe(true);
    expect(
      respondBookingSchema.safeParse({
        ...valid,
        expectedUpdatedAt: "2026-08-26T12:34:56Z",
      }).success,
    ).toBe(true);
  });

  // Es la mitad de la protección contra la carrera de plan.md §5: opcional se
  // omite sin querer, y el dev termina comprometido con algo que no vio.
  it("requires expectedUpdatedAt", () => {
    expect(respondBookingSchema.safeParse({ status: "approved" }).success).toBe(false);
  });

  // Cancelar es del PM y desplazar es de 006: esta ruta no es un segundo camino
  // para escribir cualquier estado.
  it("only accepts the two answers that belong to the developer", () => {
    for (const status of ["cancelled", "displaced", "pending"]) {
      expect(respondBookingSchema.safeParse({ ...valid, status }).success).toBe(false);
    }
  });
});
