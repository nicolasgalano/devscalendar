import { describe, expect, it } from "vitest";

import {
  blankForm,
  fromBooking,
  optionalField,
  parseTime,
  toInstants,
} from "@/lib/bookings/form";

/** Buenos Aires is UTC-3 all year: no DST since 2009. */
const TZ = "America/Argentina/Buenos_Aires";

describe("parseTime", () => {
  it("reads a time of day into minutes", () => {
    expect(parseTime("09:30")).toBe(570);
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("23:59")).toBe(1439);
    expect(parseTime(" 9:05 ")).toBe(545);
  });

  it("rejects anything that is not a real time", () => {
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("09:60")).toBeNull();
    expect(parseTime("9")).toBeNull();
    expect(parseTime("")).toBeNull();
    expect(parseTime("mediodía")).toBeNull();
  });
});

describe("toInstants", () => {
  it("resolves the wall clock in the viewer's timezone", () => {
    expect(
      toInstants({ date: "2026-08-12", startTime: "09:00", endTime: "13:00" }, TZ),
    ).toEqual({
      startsAt: "2026-08-12T12:00:00.000Z",
      endsAt: "2026-08-12T16:00:00.000Z",
    });
  });

  it("refuses a span that does not move forward", () => {
    expect(
      toInstants({ date: "2026-08-12", startTime: "13:00", endTime: "09:00" }, TZ),
    ).toBeNull();
    expect(
      toInstants({ date: "2026-08-12", startTime: "13:00", endTime: "13:00" }, TZ),
    ).toBeNull();
  });

  /**
   * El formulario no puede expresar una reserva que cruza la medianoche, y no la
   * inventa: `22:00`–`02:00` es mucho más probable que sea un error de tipeo que
   * un turno nocturno.
   */
  it("does not roll an end time over to the next day", () => {
    expect(
      toInstants({ date: "2026-08-12", startTime: "22:00", endTime: "02:00" }, TZ),
    ).toBeNull();
  });

  it("refuses a date that does not exist", () => {
    expect(
      toInstants({ date: "2026-02-30", startTime: "09:00", endTime: "13:00" }, TZ),
    ).toBeNull();
    expect(
      toInstants({ date: "12/08/2026", startTime: "09:00", endTime: "13:00" }, TZ),
    ).toBeNull();
  });
});

describe("fromBooking", () => {
  const booking = {
    project: { id: "project-1" },
    dev: { id: "dev-1" },
    startsAt: "2026-08-12T12:00:00.000Z",
    endsAt: "2026-08-12T16:30:00.000Z",
    ticketRef: "DEV-42",
    note: null,
  };

  it("round-trips through toInstants", () => {
    const form = fromBooking(booking, TZ);

    expect(form).toMatchObject({
      projectId: "project-1",
      devId: "dev-1",
      date: "2026-08-12",
      startTime: "09:00",
      endTime: "13:30",
      ticketRef: "DEV-42",
      note: "",
    });
    expect(toInstants(form, TZ)).toEqual({
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
    });
  });

  /**
   * Una reserva que termina a la medianoche vuelve con `endTime` "00:00", que no
   * es posterior al inicio: `toInstants` la rechaza y el diálogo lo dice. Falla
   * a la vista en vez de guardar un horario distinto del que se muestra.
   */
  it("fails loudly on a booking the form cannot represent", () => {
    const overnight = { ...booking, endsAt: "2026-08-13T03:00:00.000Z" };
    const form = fromBooking(overnight, TZ);

    expect(form.endTime).toBe("00:00");
    expect(toInstants(form, TZ)).toBeNull();
  });
});

describe("blankForm", () => {
  it("defaults to a one-hour booking from the clicked slot", () => {
    expect(blankForm({ date: "2026-08-12", startMinute: 570 })).toMatchObject({
      date: "2026-08-12",
      startTime: "09:30",
      endTime: "10:30",
      projectId: "",
      devId: "",
    });
  });

  it("keeps the default duration inside the day", () => {
    expect(blankForm({ date: "2026-08-12", startMinute: 23 * 60 + 30 }).endTime).toBe(
      "23:59",
    );
  });

  it("carries the prefilled lane", () => {
    expect(
      blankForm({ date: "2026-08-12", startMinute: 540, devId: "dev-1" }),
    ).toMatchObject({ devId: "dev-1", projectId: "" });
  });
});

describe("optionalField", () => {
  it("turns an emptied field into no value at all", () => {
    expect(optionalField("")).toBeNull();
    expect(optionalField("   ")).toBeNull();
    expect(optionalField(" DEV-42 ")).toBe("DEV-42");
  });
});
