"use client";

import { useEffect } from "react";

import { dispatchOpenLightbox } from "./inline-image-lightbox-bridge";

// 026. Monta un click handler delegado sobre el `<div data-rich-text-viewer>`
// que envuelve el HTML del renderer. Cada click en un `img[data-attachment-id]`
// se traduce en un `dispatchOpenLightbox(attachmentId)` — el panel de adjuntos,
// montado en la misma página, lo escucha y abre su lightbox.
//
// Delegación de eventos sobre el contenedor (no `addEventListener` por nodo):
// el HTML sale del `dangerouslySetInnerHTML` y los nodos no son controlados
// por React. Un listener en el padre con `event.target.closest(...)` es lo
// más limpio y sobrevive a re-renders del viewer.

export function InlineImageLightboxHydrator() {
  useEffect(() => {
    function handler(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const img = target.closest("img[data-attachment-id]") as HTMLImageElement | null;
      if (!img) return;

      const id = img.getAttribute("data-attachment-id");
      if (!id) return;

      event.preventDefault();
      dispatchOpenLightbox(id);
    }

    // El viewer puede estar en varios lugares del DOM a la vez (descripción
    // + N comentarios), por eso capturamos en el document — no en un wrapper
    // puntual. El selector cierra el scope.
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  return null;
}
