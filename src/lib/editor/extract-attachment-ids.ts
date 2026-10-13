// Helper que recorre un doc ProseMirror y devuelve el set único de
// `attachment_id` de todos los nodos `image`. Paralelo a `extract-mentions.ts`:
// mismo patrón de walker recursivo, misma dedupe por `Set`.
//
// El renderer server-side (`render.ts`) y la page `/tickets/[key]` usan esta
// función para saber qué signed URLs pre-firmar antes de pintar el detalle,
// sin incurrir en N+1 (una query de attachments para el conjunto completo,
// no una por nodo).

import type { ProseMirrorNode } from "./validate";

export function extractAttachmentIds(doc: ProseMirrorNode | unknown): string[] {
  const found = new Set<string>();
  visit(doc, found);
  return Array.from(found);
}

function visit(input: unknown, found: Set<string>): void {
  if (!input || typeof input !== "object") return;

  const node = input as ProseMirrorNode;

  if (
    node.type === "image" &&
    node.attrs &&
    typeof node.attrs.attachment_id === "string"
  ) {
    found.add(node.attrs.attachment_id);
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) visit(child, found);
  }
}
