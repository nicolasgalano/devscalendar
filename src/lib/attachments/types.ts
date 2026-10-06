// Whitelist única de tipos y tamaños de adjuntos.
//
// La consumen tres consumidores:
//   1. El input `<input type="file" accept=...>` del panel — filtra en el
//      selector nativo del OS.
//   2. La validación cliente-side en `upload.ts` — rechaza antes de subir.
//   3. La validación server-side en el handler POST — defensa en profundidad.
//
// Lo que acepta:
//   - Imágenes (feature 020): PNG, JPEG, WebP, GIF. Thumb WebP generado en
//     cliente con Canvas, dimensiones (width/height) extraídas también en
//     cliente, lightbox con preview inline.
//   - Documentos (feature 025): PDF, Word (.doc, .docx), Excel (.xls, .xlsx).
//     Sin thumb, sin dimensiones, click → descarga via signed URL con
//     Content-Disposition: attachment (nunca se renderiza inline en el browser).
//
// Cualquier tipo nuevo que se quiera aceptar en el futuro (PowerPoint, CSV,
// ZIP, TXT) se suma acá; los tres consumidores lo heredan sin cambios. La
// decisión por tipo nuevo es (a) si tiene thumb (hoy solo imágenes) y
// (b) cómo se renderiza en el panel (ícono por tipo via iconForMime).

export const ATTACHMENT_MIME_TYPES = [
  // Imágenes (020)
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  // Documentos (025)
  "application/pdf",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
] as const;

export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

// Para el `accept` del `<input type="file">`. Los browsers respetan la lista
// separada por comas.
export const ATTACHMENT_ACCEPT_ATTR = ATTACHMENT_MIME_TYPES.join(",");

// Hard limit por archivo. Duplicado en el `check` de la tabla como red final
// (migration 23 lo subió a 10 MB para acomodar PDFs y docs del cliente). Si
// se quiere aumentar más: (a) subirlo acá, (b) alter el `check` con una
// migration nueva, (c) confirmar que Vercel acepta el multipart más grande
// (hoy sin problema a 10 MB).
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Soft limit total por ticket. Solo advertencia en la UI — no bloquea el
// upload. Ver R-13 del plan de 020: si aparece abuso, se vuelve hard en una
// feature posterior con `SELECT ... FOR UPDATE` para atajar la carrera.
export const SOFT_TOTAL_PER_TICKET_BYTES = 50 * 1024 * 1024; // 50 MB

// El thumbnail siempre es WebP (020 §5.3 del plan). El server rechaza
// cualquier otro MIME en el field `thumb` del multipart. Solo aplica a
// imágenes; los no-imagen no envían thumb.
export const THUMB_MIME_TYPE = "image/webp" as const;

// Defensa contra un cliente que mande un binario grande como `thumb`. Un
// thumb de 300px WebP a quality 0.8 pesa típicamente 20-30 KB — 100 KB deja
// margen sobrado. Si se rechaza, el handler responde 413.
export const MAX_THUMB_SIZE_BYTES = 100 * 1024; // 100 KB

// Path structure en el bucket (020 §2.4 del plan). Se centraliza acá para
// que el handler y cualquier utility que necesite reconstruir un path use el
// mismo formato.
export const ATTACHMENT_BUCKET = "ticket-attachments" as const;

const IMAGE_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/**
 * True para los MIME types de imagen de la whitelist, false para los
 * documentos y cualquier string que no esté en la whitelist. Narrow de tipo
 * para que TypeScript sepa que después del guard el string es un
 * `AttachmentMimeType` imagen.
 *
 * La consumen el handler POST (ramifica upload de thumb), el cliente
 * (ramifica `generateThumb`) y el panel (ramifica renderer `ThumbnailCard`
 * vs. `DocumentCard`).
 */
export function isImageMime(mime: string): mime is AttachmentMimeType {
  return IMAGE_MIME_TYPES.has(mime);
}

/**
 * Agrupa cada MIME en un "kind" visual para el panel y le asigna un color
 * tono como clase utility de Tailwind. El panel resuelve el componente de
 * ícono concreto (lucide-react) a partir del `kind`.
 *
 * Mapeo:
 *   - `image/*`     → image / muted (fallback — en la práctica las imágenes
 *     se renderizan con thumbnail, no con ícono).
 *   - `pdf`         → pdf   / destructive (rojo).
 *   - `.doc/.docx`  → word  / primary (azul).
 *   - `.xls/.xlsx`  → excel / verde (emerald del design tokens).
 *   - fallback      → file  / muted.
 */
export type AttachmentIconKind = "image" | "pdf" | "word" | "excel" | "file";

export function iconForMime(
  mime: AttachmentMimeType,
): { kind: AttachmentIconKind; tone: string } {
  if (isImageMime(mime)) return { kind: "image", tone: "text-muted-foreground" };
  if (mime === "application/pdf") return { kind: "pdf", tone: "text-destructive" };
  if (
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return { kind: "word", tone: "text-primary" };
  }
  if (
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return { kind: "excel", tone: "text-emerald-600 dark:text-emerald-400" };
  }
  return { kind: "file", tone: "text-muted-foreground" };
}

export function extensionForMime(mime: AttachmentMimeType): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "application/pdf":
      return "pdf";
    case "application/msword":
      return "doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.ms-excel":
      return "xls";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "xlsx";
  }
}

// Slug ASCII normalizado del filename original. Se usa en el `object_key`
// (020 §2.4) para preservar algo del nombre original sin arriesgar signos
// raros en URLs, filesystems o headers.
//
// - Convierte a minúsculas, remueve acentos vía NFKD.
// - Reemplaza cualquier char fuera de `[a-z0-9]` por `-`.
// - Colapsa runs de `-`.
// - Trunca a 40 chars.
// - Si queda vacío, devuelve "file" — algo tiene que ir en el path.
export function slugifyFilename(name: string): string {
  const noExt = name.replace(/\.[^.]+$/, "");
  const ascii = noExt
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : "file";
}

/**
 * Arma los paths del bucket para un adjunto. Para imágenes devuelve también
 * `thumbObjectKey`; para no-imagen (PDFs, docs) el thumb es `null` porque
 * no se genera. El handler POST usa `null` como marca para no subir thumb
 * ni setear `width`/`height` en la fila.
 */
export function buildObjectKey(
  ticketId: string,
  attachmentId: string,
  filename: string,
  mime: AttachmentMimeType,
): { objectKey: string; thumbObjectKey: string | null } {
  const slug = slugifyFilename(filename);
  const ext = extensionForMime(mime);
  const objectKey = `tickets/${ticketId}/original/${attachmentId}-${slug}.${ext}`;
  const thumbObjectKey = isImageMime(mime)
    ? `tickets/${ticketId}/thumb/${attachmentId}-${slug}.webp`
    : null;
  return { objectKey, thumbObjectKey };
}

export function isAttachmentMimeType(value: string): value is AttachmentMimeType {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(value);
}
