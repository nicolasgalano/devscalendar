// 026. Paste de imágenes al editor rich text.
//
// Dos piezas:
//
//   1. `createImagePasteHandler({ ticketKey, onError })`: factoría de un
//      `editorProps.handlePaste` compatible con Tiptap. Detecta imágenes en
//      el clipboard, inserta un nodo `image` placeholder con un
//      `attachment_id` transitorio (`pending-<uuid>`) y un `src` que apunta
//      al blob local (`URL.createObjectURL`), y arranca el upload en
//      background. Cuando termina, encuentra el nodo pending en el doc y lo
//      reemplaza con los attrs finales (uuid real + width/height). Si falla,
//      lo elimina y notifica al caller.
//
//   2. Walker + utils para que el formulario que contiene el editor sepa si
//      hay subidas en curso (`docHasPendingUploads`) y pueda limpiar el doc
//      antes de guardar (`stripTransientImageAttrs`). El `src` blob local no
//      viaja al server — el renderer SSR lo resuelve desde la signed URL
//      del thumbnail en lectura.
//
// Convenciones:
//
//   - El `pending-` prefix NO es un UUID válido → el validador Zod del
//     server lo rechaza. Esto es parte del contrato: el client NO debe
//     enviar un doc con pending; el formulario espera o aborta (T3.7).
//   - El `src` con `blob:` también sería rechazado por el schema (el nodo
//     `image` no declara `src`), así que se filtra antes del PATCH. Lo que
//     el server recibe son solo attrs declarados (attachment_id, alt,
//     width, height).

import type { EditorView } from "@tiptap/pm/view";

import { isImageMime } from "@/lib/attachments/types";
import { uploadTicketAttachment } from "@/lib/attachments/upload";

import type { ProseMirrorNode } from "./validate";

const PENDING_PREFIX = "pending-";

export function makePendingAttachmentId(): string {
  return `${PENDING_PREFIX}${crypto.randomUUID()}`;
}

export function isPendingAttachmentId(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(PENDING_PREFIX);
}

// Walker que detecta si en el doc hay nodos `image` con un `attachment_id`
// transitorio (upload en vuelo). Usado por el formulario de edición para
// decidir si esperar antes de hacer PATCH. Devuelve `true` ante el primer
// hit — no cuenta todos, solo necesita saber si hay alguno.
export function docHasPendingUploads(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const node = doc as ProseMirrorNode;

  if (
    node.type === "image" &&
    isPendingAttachmentId(node.attrs?.attachment_id)
  ) {
    return true;
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (docHasPendingUploads(child)) return true;
    }
  }
  return false;
}

// Antes de mandar el doc al server, el `src` transitorio (`blob:` para
// recién pegados o signed URL hidratada para los ya guardados) se saca.
// El server solo acepta attrs declarados en el schema (attachment_id,
// alt, width, height); el renderer SSR va a resolver el `src` desde la
// signed URL del thumbnail en lectura.
export function stripTransientImageAttrs(doc: unknown): unknown {
  if (!doc || typeof doc !== "object") return doc;
  const node = doc as ProseMirrorNode & { src?: unknown };

  const cleaned: ProseMirrorNode & { src?: unknown } = { ...node };

  if (cleaned.type === "image" && cleaned.attrs) {
    // Copio sin src — mantengo attachment_id, alt, width, height.
    const rest = { ...(cleaned.attrs as Record<string, unknown>) };
    delete rest.src;
    cleaned.attrs = rest;
  }

  if (Array.isArray(cleaned.content)) {
    cleaned.content = cleaned.content.map((c) =>
      stripTransientImageAttrs(c),
    ) as ProseMirrorNode[];
  }
  return cleaned;
}

type PasteHandlerContext = {
  ticketKey: string;
  onError?: (message: string) => void;
};

export function createImagePasteHandler(
  ctx: PasteHandlerContext,
): (view: EditorView, event: ClipboardEvent) => boolean {
  return (view, event) => {
    const items = event.clipboardData?.items;
    if (!items || items.length === 0) return false;

    // AC-1.2: si el clipboard trae texto, cedemos al handler default
    // (típico cuando alguien copia desde un diseño: texto + imagen).
    const hasText = Array.from(items).some((it) => it.kind === "string");
    if (hasText) return false;

    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && isImageMime(file.type)) imageFiles.push(file);
    }

    if (imageFiles.length === 0) return false;

    event.preventDefault();

    for (const file of imageFiles) {
      void uploadAndFinalize(view, file, ctx);
    }

    return true;
  };
}

async function uploadAndFinalize(
  view: EditorView,
  file: File,
  ctx: PasteHandlerContext,
): Promise<void> {
  const pendingId = makePendingAttachmentId();
  const localUrl = URL.createObjectURL(file);

  // Nombre descriptivo para el adjunto que se persiste. El clipboard rara
  // vez trae un filename útil ("image.png" o nada); nos auto-generamos uno
  // ordenable (Q-1 del spec). Preserva la extensión del MIME.
  const extension = file.type.split("/")[1] ?? "png";
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  const pastedFile = new File([file], `pasted-${now}.${extension}`, {
    type: file.type,
  });

  const imageNodeType = view.state.schema.nodes.image;
  if (!imageNodeType) return;

  const placeholderNode = imageNodeType.create({
    attachment_id: pendingId,
    alt: pastedFile.name,
    src: localUrl,
  });

  const insertPos = view.state.selection.from;
  view.dispatch(view.state.tr.insert(insertPos, placeholderNode));

  const result = await uploadTicketAttachment(ctx.ticketKey, pastedFile, {
    source: "paste",
  });

  const nodePos = findNodeByPendingId(view, pendingId);

  if (nodePos === null) {
    // El user borró el placeholder antes de que terminara. No hay nada que
    // reemplazar — el adjunto queda en el panel con `source='paste'` igual.
    URL.revokeObjectURL(localUrl);
    return;
  }

  if (result.ok) {
    const finalNode = imageNodeType.create({
      attachment_id: result.attachment.id,
      alt: result.attachment.original_filename,
      width: result.attachment.width,
      height: result.attachment.height,
      // Mantenemos el blob local como `src` para que el editor siga
      // mostrando la imagen sin tener que pedir una signed URL. Al
      // guardar, `stripTransientImageAttrs` lo saca.
      src: localUrl,
    });
    view.dispatch(view.state.tr.replaceWith(nodePos, nodePos + 1, finalNode));
    // NO revocamos localUrl acá — el editor sigue usándolo. Se revoca al
    // desmontar el editor (gestionado por el componente).
  } else {
    view.dispatch(view.state.tr.delete(nodePos, nodePos + 1));
    URL.revokeObjectURL(localUrl);
    ctx.onError?.(result.error);
  }
}

function findNodeByPendingId(view: EditorView, pendingId: string): number | null {
  let foundPos: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (foundPos !== null) return false;
    if (node.type.name === "image" && node.attrs.attachment_id === pendingId) {
      foundPos = pos;
      return false;
    }
    return true;
  });
  return foundPos;
}
