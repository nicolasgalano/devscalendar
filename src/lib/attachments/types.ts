// Whitelist única de tipos y tamaños de adjuntos (feature 020).
//
// La consumen tres consumidores:
//   1. El input `<input type="file" accept=...>` del panel — filtra en el
//      selector nativo del OS.
//   2. La validación cliente-side en `upload.ts` — rechaza antes de subir.
//   3. La validación server-side en el handler POST — defensa en profundidad.
//
// Cualquier tipo nuevo que se quiera aceptar en el futuro (PDF, docx, zip)
// se suma acá; los tres consumidores lo heredan sin cambios. La única otra
// cosa que hay que decidir por tipo nuevo es cómo se renderiza en el panel
// (imagen → thumbnail; otro → icono por tipo + click para descargar).

export const ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

// Para el `accept` del `<input type="file">`. Los browsers respetan la lista
// separada por comas.
export const ATTACHMENT_ACCEPT_ATTR = ATTACHMENT_MIME_TYPES.join(",");

// Hard limit por archivo. Duplicado en el `check` de la tabla como red final
// (§2.1 del plan). Aumentarlo requiere: (a) subirlo acá, (b) modificar el
// `check` de la columna con una migration, (c) confirmar que el runtime del
// server puede manejar el multipart más grande.
export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// Soft limit total por ticket. Solo advertencia en la UI — no bloquea el
// upload. Ver R-13 del plan: si aparece abuso, se vuelve hard en una feature
// posterior con `SELECT ... FOR UPDATE` para atajar la carrera.
export const SOFT_TOTAL_PER_TICKET_BYTES = 50 * 1024 * 1024; // 50 MB

// El thumbnail siempre es WebP (spec §5.3 del plan). El server rechaza
// cualquier otro MIME en el field `thumb` del multipart.
export const THUMB_MIME_TYPE = "image/webp" as const;

// Defensa contra un cliente que mande un binario grande como `thumb`. Un
// thumb de 300px WebP a quality 0.8 pesa típicamente 20-30 KB — 100 KB deja
// margen sobrado. Si se rechaza, el handler responde 413.
export const MAX_THUMB_SIZE_BYTES = 100 * 1024; // 100 KB

// Path structure en el bucket (§2.4 del plan). Se centraliza acá para que
// el handler y cualquier utility que necesite reconstruir un path use el
// mismo formato.
export const ATTACHMENT_BUCKET = "ticket-attachments" as const;

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
  }
}

// Slug ASCII normalizado del filename original. Se usa en el `object_key`
// (§2.4) para preservar algo del nombre original sin arriesgar signos raros
// en URLs, filesystems o headers.
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

export function buildObjectKey(
  ticketId: string,
  attachmentId: string,
  filename: string,
  mime: AttachmentMimeType,
): { objectKey: string; thumbObjectKey: string } {
  const slug = slugifyFilename(filename);
  const ext = extensionForMime(mime);
  return {
    objectKey: `tickets/${ticketId}/original/${attachmentId}-${slug}.${ext}`,
    thumbObjectKey: `tickets/${ticketId}/thumb/${attachmentId}-${slug}.webp`,
  };
}

export function isAttachmentMimeType(value: string): value is AttachmentMimeType {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(value);
}
