import { z } from "zod";

import { RICH_TEXT_SCHEMA } from "@/lib/editor/schema";
import {
  validateProseMirrorDoc,
  type ProseMirrorNode,
} from "@/lib/editor/validate";

// Cap del texto plano extraído del doc (feature 019 §5.2). No es un cap del
// JSON: dos docs con el mismo texto pueden pesar KB muy distintos según cuánto
// formato usen, pero para el usuario ese "10.000 caracteres" son de lo que se
// lee, no del payload. Se centraliza acá para que el `<RichTextEditor>` use el
// mismo número al contar en la UI.
export const RICH_TEXT_MAX_PLAIN_LENGTH = 10_000;

// Zod schema para validar un doc de ProseMirror recibido en un body de API.
// Devuelve el doc validado (sin plainText — quien lo necesite lo recomputa).
//
// Uso típico:
//
// ```
// export const createTicketSchema = z.object({
//   ...
//   description_doc: richTextDocSchema.nullable().optional(),
// });
// ```
//
// En caso de error, cada issue reportada por el validador se convierte en un
// issue Zod separado — Next.js las agrupa en la respuesta 400 y el cliente ve
// la lista completa (útil para debugging, no es UX terminada porque los docs
// inválidos son casi siempre bugs del cliente, no errores del usuario).
export const richTextDocSchema = z
  .unknown()
  .transform((value, ctx): ProseMirrorNode => {
    const result = validateProseMirrorDoc(value, RICH_TEXT_SCHEMA);
    if (!result.ok) {
      for (const message of result.errors) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      }
      return z.NEVER;
    }

    if (result.plainText.length > RICH_TEXT_MAX_PLAIN_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `El texto no puede pasar de ${RICH_TEXT_MAX_PLAIN_LENGTH.toLocaleString("es-AR")} caracteres`,
      });
      return z.NEVER;
    }

    return result.doc;
  });

export type RichTextDoc = ProseMirrorNode;
