import { z } from "zod";

import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_THUMB_SIZE_BYTES,
  THUMB_MIME_TYPE,
} from "@/lib/attachments/types";

/**
 * Parseo y validación del multipart del POST de attachments (§3.1 del plan
 * de 020).
 *
 * Como el body es `multipart/form-data` y no JSON, Zod se aplica a un objeto
 * derivado del `FormData`. Este helper hace el `request.formData()`, extrae
 * los cuatro campos esperados y los valida:
 *
 *   - `original` (File requerido, MIME en la whitelist, size ≤ 5 MB)
 *   - `thumb`    (File requerido, MIME image/webp, size ≤ 100 KB)
 *   - `width`    (número entero positivo ≤ 20000)
 *   - `height`   (número entero positivo ≤ 20000)
 *
 * Todo lo demás en el form se ignora en silencio. Si algún campo falta o
 * no valida, la función devuelve `{ ok: false, issues }` con el detalle en
 * formato similar a `parsed.error.flatten()` — el handler traduce a 400.
 */

export type ParsedAttachmentUpload = {
  original: File;
  thumb: File;
  width: number;
  height: number;
};

export type ParseAttachmentUploadResult =
  | { ok: true; data: ParsedAttachmentUpload }
  | { ok: false; issues: Record<string, string[]> };

const dimensionSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(20000);

export async function parseAttachmentUploadForm(
  request: Request,
): Promise<ParseAttachmentUploadResult> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, issues: { _root: ["Body inválido — se esperaba multipart/form-data"] } };
  }

  const issues: Record<string, string[]> = {};

  const original = form.get("original");
  if (!(original instanceof File)) {
    issues.original = ["Falta el archivo original o no es un File"];
  } else {
    if (original.size <= 0) {
      issues.original = ["El archivo está vacío"];
    } else if (original.size > MAX_ATTACHMENT_SIZE_BYTES) {
      issues.original = [`El archivo pasa el límite (5 MB)`];
    } else if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(original.type)) {
      issues.original = [
        `Tipo de archivo no permitido: ${original.type}. Aceptados: ${ATTACHMENT_MIME_TYPES.join(", ")}`,
      ];
    }
  }

  const thumb = form.get("thumb");
  if (!(thumb instanceof File)) {
    issues.thumb = ["Falta el thumbnail o no es un File"];
  } else {
    if (thumb.size <= 0) {
      issues.thumb = ["El thumbnail está vacío"];
    } else if (thumb.size > MAX_THUMB_SIZE_BYTES) {
      issues.thumb = [`El thumbnail pasa el límite (${MAX_THUMB_SIZE_BYTES / 1024} KB)`];
    } else if (thumb.type !== THUMB_MIME_TYPE) {
      issues.thumb = [`El thumbnail debe ser ${THUMB_MIME_TYPE}, recibido ${thumb.type}`];
    }
  }

  const widthResult = dimensionSchema.safeParse(form.get("width"));
  if (!widthResult.success) {
    issues.width = widthResult.error.issues.map((i) => i.message);
  }

  const heightResult = dimensionSchema.safeParse(form.get("height"));
  if (!heightResult.success) {
    issues.height = heightResult.error.issues.map((i) => i.message);
  }

  if (Object.keys(issues).length > 0) {
    return { ok: false, issues };
  }

  // Todos los campos están validados; los casts son seguros por los checks
  // arriba.
  return {
    ok: true,
    data: {
      original: original as File,
      thumb: thumb as File,
      width: widthResult.data as number,
      height: heightResult.data as number,
    },
  };
}
