import { describe, expect, it } from "vitest";

import {
  docHasPendingUploads,
  hydrateImageSrcs,
  isPendingAttachmentId,
  makePendingAttachmentId,
  stripTransientImageAttrs,
} from "@/lib/editor/paste-image";

/**
 * 026 — Tests de las utilidades que soportan el flow de paste:
 *   - Pending token: formato + detector.
 *   - Walker `docHasPendingUploads`.
 *   - Serializadores pre/post-PATCH:
 *       `hydrateImageSrcs` setea el `src` al abrir el editor.
 *       `stripTransientImageAttrs` lo saca antes del PATCH.
 *
 * El handler de paste real (`createImagePasteHandler`) usa el EditorView de
 * ProseMirror, que no se puede instanciar sin tiptap+DOM; se verifica a mano
 * en producción (T5.4). Lo que SÍ se puede verificar es que las utilidades
 * puras hagan lo correcto.
 */

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID_2 = "22222222-2222-2222-2222-222222222222";

describe("026 paste helpers — pending id", () => {
  it("makePendingAttachmentId genera un string con prefix 'pending-'", () => {
    const id = makePendingAttachmentId();
    expect(id.startsWith("pending-")).toBe(true);
    expect(id.length).toBeGreaterThan("pending-".length);
  });

  it("isPendingAttachmentId detecta el prefix", () => {
    expect(isPendingAttachmentId("pending-abc")).toBe(true);
    expect(isPendingAttachmentId(UUID)).toBe(false);
    expect(isPendingAttachmentId(null)).toBe(false);
    expect(isPendingAttachmentId(undefined)).toBe(false);
    expect(isPendingAttachmentId(42)).toBe(false);
  });
});

describe("026 paste helpers — docHasPendingUploads", () => {
  it("doc vacío → false", () => {
    expect(docHasPendingUploads({ type: "doc", content: [] })).toBe(false);
  });

  it("doc con image uuid → false", () => {
    const doc = {
      type: "doc",
      content: [{ type: "image", attrs: { attachment_id: UUID } }],
    };
    expect(docHasPendingUploads(doc)).toBe(false);
  });

  it("doc con image pending-* → true", () => {
    const doc = {
      type: "doc",
      content: [{ type: "image", attrs: { attachment_id: "pending-abc" } }],
    };
    expect(docHasPendingUploads(doc)).toBe(true);
  });

  it("pending anidado adentro de una lista → true", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "image", attrs: { attachment_id: "pending-x" } }],
            },
          ],
        },
      ],
    };
    expect(docHasPendingUploads(doc)).toBe(true);
  });

  it("input que no es object → false", () => {
    expect(docHasPendingUploads(null)).toBe(false);
    expect(docHasPendingUploads("not a doc")).toBe(false);
    expect(docHasPendingUploads(42)).toBe(false);
  });
});

describe("026 paste helpers — stripTransientImageAttrs", () => {
  it("saca `src` de los nodos image, mantiene attachment_id/alt/width/height", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            attachment_id: UUID,
            alt: "foo.png",
            width: 100,
            height: 200,
            src: "blob:https://example.com/abc",
          },
        },
      ],
    };
    const result = stripTransientImageAttrs(doc) as { content: { attrs: Record<string, unknown> }[] };
    const attrs = result.content[0]!.attrs;
    expect(attrs.src).toBeUndefined();
    expect(attrs.attachment_id).toBe(UUID);
    expect(attrs.alt).toBe("foo.png");
    expect(attrs.width).toBe(100);
    expect(attrs.height).toBe(200);
  });

  it("no toca el doc original (devuelve nuevo)", () => {
    const original = {
      type: "doc",
      content: [{ type: "image", attrs: { attachment_id: UUID, src: "blob:x" } }],
    };
    stripTransientImageAttrs(original);
    expect((original.content[0] as { attrs: { src?: unknown } }).attrs.src).toBe(
      "blob:x",
    );
  });

  it("recorre nodos anidados", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "image",
                  attrs: { attachment_id: UUID, src: "blob:x" },
                },
              ],
            },
          ],
        },
      ],
    };
    const result = stripTransientImageAttrs(doc) as {
      content: { content: { content: { attrs: { src?: unknown } }[] }[] }[];
    };
    const nested = result.content[0]!.content[0]!.content[0]!.attrs;
    expect(nested.src).toBeUndefined();
  });
});

describe("026 paste helpers — hydrateImageSrcs", () => {
  it("setea src desde el map para un attachment uuid presente", () => {
    const doc = {
      type: "doc",
      content: [{ type: "image", attrs: { attachment_id: UUID } }],
    };
    const map = new Map([
      [UUID, { signedThumbnailUrl: "https://supa.co/sign/abc" }],
    ]);
    const result = hydrateImageSrcs(doc, map) as {
      content: { attrs: { src?: unknown } }[];
    };
    expect(result.content[0]!.attrs.src).toBe("https://supa.co/sign/abc");
  });

  it("no setea src si el attachment no está en el map", () => {
    const doc = {
      type: "doc",
      content: [{ type: "image", attrs: { attachment_id: UUID } }],
    };
    const map = new Map<string, { signedThumbnailUrl: string | null }>();
    const result = hydrateImageSrcs(doc, map) as {
      content: { attrs: { src?: unknown } }[];
    };
    expect(result.content[0]!.attrs.src).toBeUndefined();
  });

  it("no setea src si signedThumbnailUrl es null", () => {
    const doc = {
      type: "doc",
      content: [{ type: "image", attrs: { attachment_id: UUID } }],
    };
    const map = new Map([[UUID, { signedThumbnailUrl: null }]]);
    const result = hydrateImageSrcs(doc, map) as {
      content: { attrs: { src?: unknown } }[];
    };
    expect(result.content[0]!.attrs.src).toBeUndefined();
  });

  it("no toca nodos pending-*", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { attachment_id: "pending-abc", src: "blob:local" },
        },
      ],
    };
    const map = new Map([[UUID, { signedThumbnailUrl: "https://x" }]]);
    const result = hydrateImageSrcs(doc, map) as {
      content: { attrs: { src?: unknown } }[];
    };
    expect(result.content[0]!.attrs.src).toBe("blob:local");
  });

  it("mezcla: hidrata uno, deja otro intacto", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "image", attrs: { attachment_id: UUID } },
        { type: "image", attrs: { attachment_id: UUID_2 } },
      ],
    };
    const map = new Map([[UUID, { signedThumbnailUrl: "https://a" }]]);
    const result = hydrateImageSrcs(doc, map) as {
      content: { attrs: { src?: unknown } }[];
    };
    expect(result.content[0]!.attrs.src).toBe("https://a");
    expect(result.content[1]!.attrs.src).toBeUndefined();
  });
});

describe("026 paste helpers — strip + hydrate son inverse one of the other", () => {
  it("hydrate → strip devuelve el doc sin src (como si recién saliera del server)", () => {
    const serverDoc = {
      type: "doc",
      content: [{ type: "image", attrs: { attachment_id: UUID, alt: "foo" } }],
    };
    const map = new Map([[UUID, { signedThumbnailUrl: "https://x" }]]);

    const hydrated = hydrateImageSrcs(serverDoc, map);
    const roundTripped = stripTransientImageAttrs(hydrated) as {
      content: { attrs: Record<string, unknown> }[];
    };

    expect(roundTripped.content[0]!.attrs).toEqual({
      attachment_id: UUID,
      alt: "foo",
    });
  });
});
