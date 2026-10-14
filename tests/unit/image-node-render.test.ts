import { describe, expect, it } from "vitest";

import { extractAttachmentIds } from "@/lib/editor/extract-attachment-ids";
import { renderDocToHtml } from "@/lib/editor/render";
import type { ProseMirrorNode } from "@/lib/editor/validate";

/**
 * 026 — Renderer server-side del nodo `image` y walker `extractAttachmentIds`.
 *
 * El renderer bifurca en 4 ramas (ver `render.ts`):
 *   1. Sin map o attachment_id vacío → placeholder.
 *   2. id no está en el map → placeholder (adjunto borrado).
 *   3. ticketId mismatch → placeholder (defense-in-depth cross-tenant).
 *   4. signedThumbnailUrl null (firma falló) → placeholder.
 *   5. OK → <img> con src firmado.
 */

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID_2 = "22222222-2222-2222-2222-222222222222";
const TICKET_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_TICKET_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function mkDoc(nodes: ProseMirrorNode[]): ProseMirrorNode {
  return { type: "doc", content: nodes };
}

function mkImage(attachmentId: string, alt?: string): ProseMirrorNode {
  return {
    type: "image",
    attrs: { attachment_id: attachmentId, alt },
  };
}

const PLACEHOLDER = '<span class="ticket-image-missing">Imagen eliminada</span>';

describe("026 renderer — nodo image", () => {
  it("sin opts.attachments → emite placeholder", () => {
    const html = renderDocToHtml(mkDoc([mkImage(UUID)]));
    expect(html).toContain(PLACEHOLDER);
    expect(html).not.toContain("<img");
  });

  it("attachment_id no está en el map → placeholder", () => {
    const html = renderDocToHtml(mkDoc([mkImage(UUID)]), {
      attachments: new Map(),
      ticketId: TICKET_ID,
    });
    expect(html).toContain(PLACEHOLDER);
  });

  it("cross-tenant (ticketId distinto) → placeholder", () => {
    const html = renderDocToHtml(mkDoc([mkImage(UUID)]), {
      attachments: new Map([
        [
          UUID,
          {
            id: UUID,
            ticketId: OTHER_TICKET_ID,
            mimeType: "image/png",
            originalFilename: "foo.png",
            width: 100,
            height: 100,
            signedThumbnailUrl: "https://supa.co/sign/foo",
          },
        ],
      ]),
      ticketId: TICKET_ID,
    });
    expect(html).toContain(PLACEHOLDER);
  });

  it("signedThumbnailUrl null → placeholder", () => {
    const html = renderDocToHtml(mkDoc([mkImage(UUID)]), {
      attachments: new Map([
        [
          UUID,
          {
            id: UUID,
            ticketId: TICKET_ID,
            mimeType: "image/png",
            originalFilename: "foo.png",
            width: null,
            height: null,
            signedThumbnailUrl: null,
          },
        ],
      ]),
      ticketId: TICKET_ID,
    });
    expect(html).toContain(PLACEHOLDER);
  });

  it("todo OK → emite <img> con src, alt y data-attachment-id", () => {
    const html = renderDocToHtml(mkDoc([mkImage(UUID, "mi captura")]), {
      attachments: new Map([
        [
          UUID,
          {
            id: UUID,
            ticketId: TICKET_ID,
            mimeType: "image/png",
            originalFilename: "foo.png",
            width: 100,
            height: 100,
            signedThumbnailUrl: "https://supa.co/sign/foo",
          },
        ],
      ]),
      ticketId: TICKET_ID,
    });
    expect(html).toContain("<img");
    expect(html).toContain('src="https://supa.co/sign/foo"');
    expect(html).toContain('alt="mi captura"');
    expect(html).toContain(`data-attachment-id="${UUID}"`);
    expect(html).not.toContain(PLACEHOLDER);
  });

  it("alt fallback al original_filename cuando el nodo no trae alt", () => {
    const html = renderDocToHtml(mkDoc([mkImage(UUID)]), {
      attachments: new Map([
        [
          UUID,
          {
            id: UUID,
            ticketId: TICKET_ID,
            mimeType: "image/png",
            originalFilename: "pasted-2026-10-13.png",
            width: null,
            height: null,
            signedThumbnailUrl: "https://supa.co/sign/foo",
          },
        ],
      ]),
      ticketId: TICKET_ID,
    });
    expect(html).toContain('alt="pasted-2026-10-13.png"');
  });

  it("escapa signedUrl con caracteres especiales en src", () => {
    const html = renderDocToHtml(mkDoc([mkImage(UUID)]), {
      attachments: new Map([
        [
          UUID,
          {
            id: UUID,
            ticketId: TICKET_ID,
            mimeType: "image/png",
            originalFilename: "x.png",
            width: null,
            height: null,
            signedThumbnailUrl: 'https://a.co/x?q="y"&z=1',
          },
        ],
      ]),
      ticketId: TICKET_ID,
    });
    // escapeAttr convierte " a &quot;, & a &amp;.
    expect(html).toContain("&quot;y&quot;");
    expect(html).toContain("&amp;z=1");
  });
});

describe("026 walker — extractAttachmentIds", () => {
  it("doc vacío → []", () => {
    expect(extractAttachmentIds({ type: "doc", content: [] })).toEqual([]);
  });

  it("doc sin image → []", () => {
    expect(
      extractAttachmentIds({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hola" }] }],
      }),
    ).toEqual([]);
  });

  it("un solo image → [uuid]", () => {
    expect(extractAttachmentIds(mkDoc([mkImage(UUID)]))).toEqual([UUID]);
  });

  it("varios image → únicos", () => {
    const result = extractAttachmentIds(
      mkDoc([mkImage(UUID), mkImage(UUID_2), mkImage(UUID)]),
    );
    expect(result.sort()).toEqual([UUID, UUID_2].sort());
  });

  it("image anidado en bulletList > listItem → encontrado", () => {
    const doc = mkDoc([
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [mkImage(UUID)],
          },
        ],
      },
    ]);
    expect(extractAttachmentIds(doc)).toEqual([UUID]);
  });

  it("input no-objeto → []", () => {
    expect(extractAttachmentIds(null)).toEqual([]);
    expect(extractAttachmentIds("not a doc")).toEqual([]);
    expect(extractAttachmentIds(42)).toEqual([]);
  });

  it("ignora attachment_id que no es string (edge case defensivo)", () => {
    const doc = {
      type: "doc",
      content: [{ type: "image", attrs: { attachment_id: null } }],
    };
    expect(extractAttachmentIds(doc)).toEqual([]);
  });
});
