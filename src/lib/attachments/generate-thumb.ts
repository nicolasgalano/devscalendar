/**
 * Genera un thumbnail WebP a partir de un File de imagen, en el cliente
 * (feature 020, §4 del plan).
 *
 * El original nunca se comprime — se sube tal cual. Este helper solo produce
 * un WebP chico para el panel del detalle (grid de thumbs). El original se
 * sirve al abrir el lightbox.
 *
 * Trade-offs elegidos:
 *
 * - **`createImageBitmap` + `OffscreenCanvas`.** APIs modernas soportadas
 *   en Chromium, Firefox y Safari 16.4+. Más rápidas que `Image + onload` y
 *   sin issues de CORS. En browsers viejos tira `Error` claro y el llamador
 *   lo muestra al usuario — no se implementa fallback a `<canvas>` DOM.
 *
 * - **Máximo 300px del lado mayor.** Suficiente para thumbs de 150×150 en
 *   retina 2x. Si el original ya es más chico, se sube tal cual (`scale = 1`)
 *   — sin upscale.
 *
 * - **WebP con `quality: 0.8`.** Sweet spot: visualmente indistinguible del
 *   original al tamaño del thumb, pesa ~25 KB.
 */

export type GeneratedThumb = {
  /** El WebP como Blob, listo para adjuntar al `FormData`. */
  blob: Blob;
  /**
   * Dimensiones NATURALES del original (no del thumb). Se guardan en la fila
   * `ticket_attachments.width`/`height` para calcular aspect-ratio en el
   * layout sin descargar el binario.
   */
  width: number;
  height: number;
};

const MAX_SIDE = 300;
const WEBP_QUALITY = 0.8;

export async function generateThumb(file: File): Promise<GeneratedThumb> {
  if (typeof createImageBitmap !== "function") {
    throw new Error(
      "Tu navegador no soporta la generación de miniaturas. Actualizá o usá otro.",
    );
  }
  if (typeof OffscreenCanvas !== "function") {
    throw new Error(
      "Tu navegador no soporta OffscreenCanvas. Actualizá o usá otro.",
    );
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("No se pudo obtener el contexto 2D del canvas");
    }
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    const blob = await canvas.convertToBlob({
      type: "image/webp",
      quality: WEBP_QUALITY,
    });

    return {
      blob,
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    // Liberar el bitmap explícitamente — sin esto el GC puede tardar y con
    // uploads en paralelo la memoria se acumula.
    bitmap.close();
  }
}
