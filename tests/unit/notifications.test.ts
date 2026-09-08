import { describe, expect, it } from "vitest";

import { emailBody, emailSubject } from "@/lib/notifications/email";
import {
  NOTIFICATION_TYPES,
  describeSlot,
  notificationDetail,
  notificationHref,
  notificationTitle,
  unreadCount,
} from "@/lib/notifications/events";

/**
 * T4.1 — feature 010. Las funciones puras del aviso: el texto que ve la persona
 * y el que sale por mail. La regla de a quién se le avisa vive en la base
 * (`notify_user`), así que eso lo cubre integración, no esto.
 */
describe("notification copy", () => {
  it("has a title for every type", () => {
    // Si mañana se agrega un tipo, este test es el que avisa antes de que llegue
    // un aviso sin texto a la campana de alguien.
    for (const type of NOTIFICATION_TYPES) {
      expect(notificationTitle(type)).toBeTruthy();
    }
  });

  it("describes the slot with project and range", () => {
    const text = describeSlot(
      {
        project: "Proyecto X",
        starts_at: "2026-10-14T12:00:00Z",
        ends_at: "2026-10-14T16:00:00Z",
      },
      "UTC",
    );

    expect(text).toContain("Proyecto X");
    expect(text).toContain("12:00");
    expect(text).toContain("16:00");
  });

  it("degrades to whatever it has", () => {
    // El payload se congela al escribir la fila; si un evento futuro guarda
    // menos, el aviso tiene que seguir siendo legible en vez de romper.
    expect(describeSlot({ project: "Solo proyecto" })).toBe("Solo proyecto");
    expect(describeSlot({})).toBe("");
  });

  it("carries the rejection reason, because a reason-less rejection sends you looking", () => {
    const detail = notificationDetail("booking_rejected", {
      response_note: "Esa semana estoy en otro cliente",
    });

    expect(detail).toContain("Esa semana estoy en otro cliente");
  });

  it("names the project that took the slot", () => {
    // AC-1.5, y es el aviso que justifica la feature entera: "te desplazaron"
    // sin decir quién obliga a entrar a averiguarlo.
    const detail = notificationDetail("booking_displaced", {
      displaced_by_project: "Proyecto Urgente",
    });

    expect(detail).toContain("Proyecto Urgente");
  });

  it("has no detail line when there is nothing to add", () => {
    expect(notificationDetail("booking_created", { project: "X" })).toBeNull();
    expect(notificationDetail("booking_rejected", {})).toBeNull();
  });

  it("links to the booking, and to the calendar when there is none", () => {
    expect(notificationHref("abc")).toBe("/calendar?booking=abc");
    expect(notificationHref(null)).toBe("/calendar");
  });

  it("counts only unread", () => {
    expect(
      unreadCount([{ readAt: null }, { readAt: "2026-10-01T00:00:00Z" }, { readAt: null }]),
    ).toBe(2);
    expect(unreadCount([])).toBe(0);
  });
});

describe("notification email", () => {
  const payload = {
    project: "Proyecto X",
    starts_at: "2026-10-14T12:00:00Z",
    ends_at: "2026-10-14T16:00:00Z",
  };

  it("puts the what and the when in the subject", () => {
    const subject = emailSubject("booking_created", payload);

    expect(subject).toContain("Te reservaron tiempo");
    expect(subject).toContain("Proyecto X");
  });

  it("keeps the body short and always links back", () => {
    const body = emailBody(
      "booking_displaced",
      {
        ...payload,
        displaced_by_project: "Proyecto Urgente",
      },
      "https://app.example/calendar?booking=1",
    );

    expect(body).toContain("Proyecto Urgente");
    expect(body).toContain("https://app.example/calendar?booking=1");
    // Q-R1: lo mínimo útil. Un mail sale del producto y no vuelve — no se
    // corrige ni se retira, y llega a la bandeja personal de cada uno.
    expect(body.split("\n").length).toBeLessThanOrEqual(6);
  });
});
