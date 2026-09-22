import { describe, expect, it } from "vitest";

import { extractMentionUserIds } from "@/lib/editor/extract-mentions";
import { renderDocToHtml } from "@/lib/editor/render";
import { richTextDocSchema } from "@/lib/validation/rich-text";

// Feature 022 — el nodo `mention` compartido por descripción y comentarios.
// El SQL paralelo (extract_mention_user_ids) tiene que dar el mismo resultado
// que estas fixtures; ver docs/comment del validador y la migration 21.

const UUID_1 = "11111111-1111-1111-1111-111111111111";
const UUID_2 = "22222222-2222-2222-2222-222222222222";
const UUID_3 = "33333333-3333-3333-3333-333333333333";

function mentionNode(userId: string, label: string) {
  return { type: "mention", attrs: { user_id: userId, label } };
}

describe("022 mention — validador Zod", () => {
  it("acepta un doc con mention bien formada", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hola " },
            mentionNode(UUID_1, "Fulana"),
            { type: "text", text: ", mirá esto." },
          ],
        },
      ],
    };
    const parsed = richTextDocSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
  });

  it("rechaza mention con user_id que no es uuid", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [mentionNode("not-a-uuid", "X")],
        },
      ],
    };
    const parsed = richTextDocSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("rechaza mention sin attrs.label (requeridas por schema)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { user_id: UUID_1 } }],
        },
      ],
    };
    const parsed = richTextDocSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("rechaza mention con content (es leaf)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mention",
              attrs: { user_id: UUID_1, label: "X" },
              content: [{ type: "text", text: "no" }],
            },
          ],
        },
      ],
    };
    const parsed = richTextDocSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("rechaza mention con attrs extra no declaradas", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mention",
              attrs: { user_id: UUID_1, label: "X", role: "pm" },
            },
          ],
        },
      ],
    };
    const parsed = richTextDocSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });
});

describe("022 mention — renderer server-side", () => {
  it("emite <span> con data-mention-user-id y la label escapada", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [mentionNode(UUID_1, "Fulana")],
        },
      ],
    };
    const html = renderDocToHtml(doc as never);
    expect(html).toContain(`data-mention-user-id="${UUID_1}"`);
    expect(html).toContain("@Fulana");
    expect(html).toContain("bg-brand-50");
  });

  it("escapa HTML en la label para evitar inyección", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [mentionNode(UUID_1, "<script>alert(1)</script>")],
        },
      ],
    };
    const html = renderDocToHtml(doc as never);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("022 extract-mentions (TS) — paralelo al SQL", () => {
  it("devuelve set vacío para doc sin menciones", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "sin nadie" }],
        },
      ],
    };
    expect(extractMentionUserIds(doc)).toEqual([]);
  });

  it("extrae user_id únicos, deduplicando repetidas", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            mentionNode(UUID_1, "A"),
            { type: "text", text: " y también " },
            mentionNode(UUID_2, "B"),
            { type: "text", text: ", otra vez " },
            mentionNode(UUID_1, "A"),
          ],
        },
      ],
    };
    const found = extractMentionUserIds(doc);
    expect(found.sort()).toEqual([UUID_1, UUID_2].sort());
  });

  it("navega bloques anidados (listas, blockquotes, taskList)", () => {
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
                  type: "paragraph",
                  content: [mentionNode(UUID_1, "A")],
                },
              ],
            },
          ],
        },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [mentionNode(UUID_2, "B")],
            },
          ],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                {
                  type: "paragraph",
                  content: [mentionNode(UUID_3, "C")],
                },
              ],
            },
          ],
        },
      ],
    };
    const found = extractMentionUserIds(doc);
    expect(found.sort()).toEqual([UUID_1, UUID_2, UUID_3].sort());
  });

  it("tolera valores no-objeto sin explotar", () => {
    expect(extractMentionUserIds(null)).toEqual([]);
    expect(extractMentionUserIds(undefined)).toEqual([]);
    expect(extractMentionUserIds("string")).toEqual([]);
    expect(extractMentionUserIds(42)).toEqual([]);
  });

  it("ignora mention sin user_id (defensivo)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { label: "solo label" } }],
        },
      ],
    };
    expect(extractMentionUserIds(doc)).toEqual([]);
  });
});
