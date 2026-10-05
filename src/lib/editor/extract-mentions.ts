// Helper que recorre un doc ProseMirror y devuelve el set único de `user_id`
// de todos los nodos `mention`. Paralelo al SQL `extract_mention_user_ids()`
// de la migration 21: dos implementaciones que TIENEN que dar el mismo
// resultado. Si aparece divergencia, arreglar las dos.
//
// El handler POST/PATCH de comentarios usa esta función para validar que
// cada mencionado sea miembro activo del proyecto ANTES de escribir en la
// base — el trigger SQL solo se apoya en la fila persistida y no puede
// rebotar con un 422 amigable.

import type { ProseMirrorNode } from "./validate";

export function extractMentionUserIds(doc: ProseMirrorNode | unknown): string[] {
  const found = new Set<string>();
  visit(doc, found);
  return Array.from(found);
}

function visit(input: unknown, found: Set<string>): void {
  if (!input || typeof input !== "object") return;

  const node = input as ProseMirrorNode;

  if (node.type === "mention" && node.attrs && typeof node.attrs.user_id === "string") {
    found.add(node.attrs.user_id);
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) visit(child, found);
  }
  if (Array.isArray(node.marks)) {
    for (const mark of node.marks) visit(mark as unknown, found);
  }
}
