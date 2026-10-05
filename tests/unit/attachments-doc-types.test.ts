import { describe, expect, it } from "vitest";

import {
  buildObjectKey,
  extensionForMime,
  iconForMime,
  isImageMime,
  type AttachmentMimeType,
} from "@/lib/attachments/types";

/**
 * 025 — Guardrail de la expansión de tipos (imágenes + documentos).
 *
 * El pipeline del adjunto bifurca por `isImageMime` en 4 lugares distintos
 * (handler POST, signed-url handler, cliente upload, panel UI). Este test
 * asegura que los helpers mantienen el contrato:
 *
 *   - Las 4 imágenes del whitelist devuelven true en `isImageMime`.
 *   - Los 5 tipos de documento (PDF + Word x2 + Excel x2) devuelven false.
 *   - `iconForMime` mapea cada MIME a su `kind` esperado.
 *   - `extensionForMime` mapea cada MIME a la extensión canónica.
 *   - `buildObjectKey` devuelve `thumbObjectKey` **no null** para imágenes
 *     y **null** para no-imagen.
 */

const IMAGE_MIMES: AttachmentMimeType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

const DOC_MIMES: AttachmentMimeType[] = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

describe("025 · isImageMime", () => {
  it.each(IMAGE_MIMES)("%s → true", (mime) => {
    expect(isImageMime(mime)).toBe(true);
  });

  it.each(DOC_MIMES)("%s → false", (mime) => {
    expect(isImageMime(mime)).toBe(false);
  });

  it("string arbitrario → false", () => {
    expect(isImageMime("application/x-weird-type")).toBe(false);
    expect(isImageMime("")).toBe(false);
  });
});

describe("025 · iconForMime", () => {
  it.each(IMAGE_MIMES)("%s → kind image", (mime) => {
    expect(iconForMime(mime).kind).toBe("image");
  });

  it("application/pdf → kind pdf, tono destructive", () => {
    const result = iconForMime("application/pdf");
    expect(result.kind).toBe("pdf");
    expect(result.tone).toContain("destructive");
  });

  it("application/msword (.doc) → kind word", () => {
    expect(iconForMime("application/msword").kind).toBe("word");
  });

  it(".docx → kind word (mismo que .doc)", () => {
    expect(
      iconForMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document").kind,
    ).toBe("word");
  });

  it("application/vnd.ms-excel (.xls) → kind excel", () => {
    expect(iconForMime("application/vnd.ms-excel").kind).toBe("excel");
  });

  it(".xlsx → kind excel (mismo que .xls)", () => {
    expect(
      iconForMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").kind,
    ).toBe("excel");
  });
});

describe("025 · extensionForMime", () => {
  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["application/pdf", "pdf"],
    ["application/msword", "doc"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
    ["application/vnd.ms-excel", "xls"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ])("%s → %s", (mime, ext) => {
    expect(extensionForMime(mime as AttachmentMimeType)).toBe(ext);
  });
});

describe("025 · buildObjectKey", () => {
  const ticketId = "11111111-1111-1111-1111-111111111111";
  const attachmentId = "22222222-2222-2222-2222-222222222222";

  it("imagen → thumbObjectKey no null, matchea el path esperado", () => {
    const { objectKey, thumbObjectKey } = buildObjectKey(
      ticketId,
      attachmentId,
      "screenshot.png",
      "image/png",
    );
    expect(objectKey).toBe(
      `tickets/${ticketId}/original/${attachmentId}-screenshot.png`,
    );
    expect(thumbObjectKey).toBe(
      `tickets/${ticketId}/thumb/${attachmentId}-screenshot.webp`,
    );
  });

  it("PDF → thumbObjectKey null; extensión .pdf en el original", () => {
    const { objectKey, thumbObjectKey } = buildObjectKey(
      ticketId,
      attachmentId,
      "informe.pdf",
      "application/pdf",
    );
    expect(objectKey).toBe(
      `tickets/${ticketId}/original/${attachmentId}-informe.pdf`,
    );
    expect(thumbObjectKey).toBeNull();
  });

  it("Word (.docx) → thumbObjectKey null; extensión .docx", () => {
    const { objectKey, thumbObjectKey } = buildObjectKey(
      ticketId,
      attachmentId,
      "propuesta.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(objectKey).toContain(".docx");
    expect(thumbObjectKey).toBeNull();
  });

  it("Excel (.xlsx) → thumbObjectKey null; extensión .xlsx", () => {
    const { objectKey, thumbObjectKey } = buildObjectKey(
      ticketId,
      attachmentId,
      "datos.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(objectKey).toContain(".xlsx");
    expect(thumbObjectKey).toBeNull();
  });
});
