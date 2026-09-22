import { z } from "zod";

import { richTextDocSchema } from "./rich-text";

// Body del POST /api/tickets/[id]/comments.
// El validador del rich text (heredado de 019) rebota docs con nodos
// no permitidos, marks fuera de la whitelist, links con protocolos raros
// o mentions con user_id no-uuid.
export const commentBodySchema = z.object({
  body_doc: richTextDocSchema,
});

// Body del PATCH /api/tickets/[id]/comments/[commentId].
// `expected_updated_at` cierra la ventana entre lectura y escritura
// (patrón 005 / 019). Sin ese chequeo, dos sesiones del mismo autor
// editando en paralelo se pisan sin aviso.
export const commentPatchSchema = commentBodySchema.extend({
  expected_updated_at: z.string().datetime({ offset: true }),
});

export type CommentBody = z.infer<typeof commentBodySchema>;
export type CommentPatchBody = z.infer<typeof commentPatchSchema>;
