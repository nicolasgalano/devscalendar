import { describe, expect, it } from "vitest";

import { renderDocToHtml } from "@/lib/editor/render";
import { RICH_TEXT_SCHEMA } from "@/lib/editor/schema";
import { validateProseMirrorDoc } from "@/lib/editor/validate";
import { richTextDocSchema } from "@/lib/validation/rich-text";

// Smoke test de Phase 1 (019). Cubre lo mínimo indispensable — el catálogo
// completo de casos de la T7 (aspiracional) queda para cuando se decida
// invertir en test coverage acá.
describe("019 rich text — schema, validator, renderer", () => {
  it("valida un doc con headings, listas, links, tasklist y code block", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hola" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Un ", marks: [{ type: "bold" }] },
            {
              type: "text",
              text: "link",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "hecho" }] },
              ],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "javascript" },
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ],
    };
    const parsed = richTextDocSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
  });

  it("rechaza doc con nodo image (reservado para 020)", () => {
    const doc = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://x.com/a.png" } }],
    };
    const parsed = richTextDocSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("rechaza link con protocolo javascript:", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    };
    const parsed = richTextDocSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("rechaza codeBlock con language fuera de la whitelist", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "cobol" },
          content: [{ type: "text", text: "..." }],
        },
      ],
    };
    const parsed = richTextDocSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("rechaza nodo desconocido", () => {
    const doc = {
      type: "doc",
      content: [{ type: "mention", attrs: { userId: "abc" } }],
    };
    const parsed = richTextDocSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("rechaza attr no declarada (whitelist positiva)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://x.com", onClick: "alert(1)" },
                },
              ],
            },
          ],
        },
      ],
    };
    const parsed = richTextDocSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("rechaza plainText > 10.000 caracteres", () => {
    const long = "a".repeat(10_001);
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: long }] },
      ],
    };
    const parsed = richTextDocSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("extrae plainText separando bloques con \\n", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "uno" }] },
        { type: "paragraph", content: [{ type: "text", text: "dos" }] },
      ],
    };
    const result = validateProseMirrorDoc(doc, RICH_TEXT_SCHEMA);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plainText).toBe("uno\ndos");
    }
  });

  it("renderiza a HTML con links target=_blank rel=noopener", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "sitio",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    };
    const html = renderDocToHtml(doc);
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">sitio</a>');
    expect(html).toContain("<p>");
  });

  it("renderiza taskItem con data-task-index y span marker", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "pendiente" }] },
              ],
            },
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "hecho" }] },
              ],
            },
          ],
        },
      ],
    };
    const html = renderDocToHtml(doc);
    expect(html).toContain('data-task-index="0"');
    expect(html).toContain('data-task-index="1"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('data-checked="false"');
    expect(html).toContain('<span data-task-item-marker></span>');
  });

  it("escapa entidades HTML en texto", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "<script>alert(1)</script>" }],
        },
      ],
    };
    const html = renderDocToHtml(doc);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
