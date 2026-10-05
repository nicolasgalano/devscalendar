import { z } from "zod";

import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_THUMB_SIZE_BYTES,
  THUMB_MIME_TYPE,
  isImageMime,
} from "@/lib/attachments/types";

/**
 * Parseo y validación del multipart del POST de attachments.
 *
 * El body es `multipart/form-data` — Zod se aplica a un objeto derivado del
 * `FormData`. Este helper hace el `request.formData()`, extrae los campos
 * esperados y los valida contra la whitelist y los límites.
 *
 * Campos:
 *   - `original` (File requerido, MIME en la whitelist, size ≤ 10 MB).
 *   - `thumb`    (File opcional — requerido solo si `original` es imagen,
 *                MIME image/webp, size ≤ 100 KB).
 *   - `width`    (opcional — requerido solo si `original` es imagen, int positivo ≤ 20000).
 *   - `height`   (opcional — requerido solo si `original` es imagen, int positivo ≤ 20000).
 *
 * **Thumb/width/height solo para imágenes.** Las imágenes se renderizan como
 * thumbnail en el panel y necesitan dimensiones para calcular aspect-ratio
 * sin descargar el binario. Los documentos (025) no tienen esos tres — el
 * cliente no los envía y este validador no los exige. Si vienen igual con un
 * `original` no-imagen, se ignoran en silencio para no romper clientes que
 * los manden de más.
 *
 * Todo lo demás en el form se ignora en silencio. Si algún campo falta o no
 * valida, la función devuelve `{ ok: false, issues }` con el detalle — el
 * handler traduce a 400.
 */

export type ParsedAttachmentUpload = {
  original: File;
  thumb?: File;
  width?: number;
  height?: number;
};

export type ParseAttachmentUploadResult =
  | { ok: true; data: ParsedAttachmentUpload }
  | { ok: false; issues: Record<string, string[]> };

const dimensionSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(20000);

const MAX_SIZE_MB = MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024;

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
  let originalIsImage = false;

  if (!(original instanceof File)) {
    issues.original = ["Falta el archivo original o no es un File"];
  } else {
    if (original.size <= 0) {
      issues.original = ["El archivo está vacío"];
    } else if (original.size > MAX_ATTACHMENT_SIZE_BYTES) {
      issues.original = [`El archivo pasa el límite (${MAX_SIZE_MB} MB)`];
    } else if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(original.type)) {
      issues.original = [
        `Tipo de archivo no permitido: ${original.type}. Aceptados: ${ATTACHMENT_MIME_TYPES.join(", ")}`,
      ];
    } else {
      originalIsImage = isImageMime(original.type);
    }
  }

  // Thumb/width/height son requeridos solo si `original` es una imagen válida.
  // Para no-imagen se ignoran — pueden venir o no, no se agregan a `issues`.
  const thumbField = form.get("thumb");
  let parsedThumb: File | undefined;
  if (originalIsImage) {
    if (!(thumbField instanceof File)) {
      issues.thumb = ["Falta el thumbnail o no es un File"];
    } else {
      if (thumbField.size <= 0) {
        issues.thumb = ["El thumbnail está vacío"];
      } else if (thumbField.size > MAX_THUMB_SIZE_BYTES) {
        issues.thumb = [`El thumbnail pasa el límite (${MAX_THUMB_SIZE_BYTES / 1024} KB)`];
      } else if (thumbField.type !== THUMB_MIME_TYPE) {
        issues.thumb = [`El thumbnail debe ser ${THUMB_MIME_TYPE}, recibido ${thumbField.type}`];
      } else {
        parsedThumb = thumbField;
      }
    }
  }

  let parsedWidth: number | undefined;
  let parsedHeight: number | undefined;
  if (originalIsImage) {
    const widthResult = dimensionSchema.safeParse(form.get("width"));
    if (!widthResult.success) {
      issues.width = widthResult.error.issues.map((i) => i.message);
    } else {
      parsedWidth = widthResult.data;
    }

    const heightResult = dimensionSchema.safeParse(form.get("height"));
    if (!heightResult.success) {
      issues.height = heightResult.error.issues.map((i) => i.message);
    } else {
      parsedHeight = heightResult.data;
    }
  }

  if (Object.keys(issues).length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    data: {
      original: original as File,
      ...(parsedThumb ? { thumb: parsedThumb } : {}),
      ...(parsedWidth !== undefined ? { width: parsedWidth } : {}),
      ...(parsedHeight !== undefined ? { height: parsedHeight } : {}),
    },
  };
}
