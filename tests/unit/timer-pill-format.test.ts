import { describe, expect, it } from "vitest";

import { formatSecondsClock } from "@/lib/time-entries/format";

/**
 * `formatSecondsClock` es el formato del contador del `<TimerPill>` corriendo.
 * El bug reportado por el equipo (2026-10-19) era que el pill mostraba
 * `H:MM` (minutos enteros) y el tick corría cada 60s — resultado: el display
 * quedaba congelado durante 59s entre actualizaciones. El fix bajó el tick
 * a 1s y pasó el formato a `H:MM:SS`.
 */
describe("formatSecondsClock", () => {
  it("cero segundos → '0:00:00'", () => {
    expect(formatSecondsClock(0)).toBe("0:00:00");
  });

  it("sub-minuto → '0:00:SS'", () => {
    expect(formatSecondsClock(1)).toBe("0:00:01");
    expect(formatSecondsClock(34)).toBe("0:00:34");
    expect(formatSecondsClock(59)).toBe("0:00:59");
  });

  it("minutos → '0:MM:SS'", () => {
    expect(formatSecondsClock(60)).toBe("0:01:00");
    expect(formatSecondsClock(60 + 23)).toBe("0:01:23");
    expect(formatSecondsClock(12 * 60 + 34)).toBe("0:12:34");
  });

  it("horas → 'H:MM:SS'", () => {
    expect(formatSecondsClock(3600)).toBe("1:00:00");
    expect(formatSecondsClock(3600 + 23 * 60 + 45)).toBe("1:23:45");
  });

  it("horas de dos dígitos sin pad", () => {
    expect(formatSecondsClock(12 * 3600 + 34 * 60 + 56)).toBe("12:34:56");
  });

  it("segundos negativos → cero (defensivo contra clock skew)", () => {
    expect(formatSecondsClock(-5)).toBe("0:00:00");
  });

  it("fracciones redondean hacia abajo", () => {
    expect(formatSecondsClock(0.9)).toBe("0:00:00");
    expect(formatSecondsClock(1.5)).toBe("0:00:01");
    expect(formatSecondsClock(59.99)).toBe("0:00:59");
  });
});
