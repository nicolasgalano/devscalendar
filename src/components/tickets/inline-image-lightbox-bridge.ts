// 026. Pub/sub mínimo entre el viewer rich text y el panel de adjuntos para
// abrir el lightbox del panel al clickear una imagen inline del doc.
//
// El viewer SSR emite `<img data-attachment-id="...">`; un hidratador cliente
// (`<InlineImageLightboxHydrator>`) escucha clicks sobre esos `<img>` y
// dispatcha un `CustomEvent('ticket-attachment:open', { detail: { id } })`
// en `window`. El panel, que ya maneja el state del lightbox, escucha ese
// evento y resuelve el `attachmentId` → índice en su listado.
//
// Diseño:
//
//   - CustomEvent sobre `window`: desacopla viewer de panel sin introducir
//     un contexto React compartido ni un store global, y sin tocar el
//     renderer SSR (que es puro).
//   - La payload es solo el `attachment_id`. El panel sabe de su propio
//     listado, no el viewer.
//   - Si el panel no está montado (ej. en una fase futura donde el viewer
//     vive en otra ruta), nadie escucha el evento y el click no hace nada
//     — degrada seguro.

export const OPEN_LIGHTBOX_EVENT = "ticket-attachment:open";

export type OpenLightboxDetail = { attachmentId: string };

export function dispatchOpenLightbox(attachmentId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenLightboxDetail>(OPEN_LIGHTBOX_EVENT, {
      detail: { attachmentId },
    }),
  );
}
