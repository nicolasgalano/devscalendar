import { describe, expect, it } from "vitest";

import { humanizeElapsed } from "@/lib/time-entries/format";

describe("humanizeElapsed", () => {
  it('describe < 60s como "menos de 1 min"', () => {
    expect(humanizeElapsed(0)).toBe("menos de 1 min");
    expect(humanizeElapsed(1)).toBe("menos de 1 min");
    expect(humanizeElapsed(59)).toBe("menos de 1 min");
  });

  it('redondea para abajo a minutos entre 1 y 59 min ("N min")', () => {
    expect(humanizeElapsed(60)).toBe("1 min");
    expect(humanizeElapsed(60 * 15 + 10)).toBe("15 min");
    expect(humanizeElapsed(60 * 59 + 59)).toBe("59 min");
  });

  it('entre 1 y 23 h muestra "N h" o "N h M min"', () => {
    expect(humanizeElapsed(60 * 60)).toBe("1 h");
    expect(humanizeElapsed(60 * 60 + 60 * 20)).toBe("1 h 20 min");
    expect(humanizeElapsed(60 * 60 * 23 + 60 * 15)).toBe("23 h 15 min");
  });

  it('≥ 24 h muestra "N d" o "N d H h"', () => {
    expect(humanizeElapsed(60 * 60 * 24)).toBe("1 d");
    expect(humanizeElapsed(60 * 60 * 24 + 60 * 60 * 7)).toBe("1 d 7 h");
    expect(humanizeElapsed(60 * 60 * 24 * 48)).toBe("48 d");
  });

  it("se protege contra valores negativos (clamps a 0)", () => {
    expect(humanizeElapsed(-10)).toBe("menos de 1 min");
  });

  it("acepta valores fraccionales (floor interno)", () => {
    expect(humanizeElapsed(60.9)).toBe("1 min");
  });
});
