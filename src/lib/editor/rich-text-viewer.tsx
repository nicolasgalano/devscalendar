import { cn } from "@/lib/utils";

import { renderDocToHtml } from "./render";
import { TaskItemHydrator } from "./task-item-hydrator";
import type { ProseMirrorNode } from "./validate";

// Viewer server-side del rich text de 019. Reemplaza al `<MarkdownViewer>` en
// el detalle del ticket cuando `description_doc !== null`. Server component
// puro: no importa Tiptap ni ProseMirror en el bundle del cliente.
//
// `renderDocToHtml(doc)` construye HTML seguro desde el JSON validado — el
// `dangerouslySetInnerHTML` acá es seguro porque el string se genera dentro
// de nuestro código, no viene parseado desde HTML de terceros. El sanitize
// vive en el renderer, no acá.
//
// Cuando `canEditChecklist && ticketId` están, se monta `<TaskItemHydrator>`
// como hermano — busca los `span[data-task-item-marker]` que emite el
// renderer para cada `taskItem` y les monta un checkbox interactivo por
// encima. Sin `canEditChecklist`, el HTML sigue mostrando el `data-checked`
// como estado visual (via CSS del wrapper), pero sin interacción.
//
// Estilos del wrapper: idénticos al `<MarkdownViewer>` para que un ticket
// migrado y uno no migrado se vean iguales (mitigación de R-4 del plan).

type RichTextViewerProps = {
  doc: ProseMirrorNode | null;
  className?: string;
  ticketId?: string;
  canEditChecklist?: boolean;
  expectedUpdatedAt?: string;
};

export function RichTextViewer({
  doc,
  className,
  ticketId,
  canEditChecklist,
  expectedUpdatedAt,
}: RichTextViewerProps) {
  if (!doc || isEmptyDoc(doc)) {
    return (
      <p className={cn("text-muted-foreground text-ui italic", className)}>
        Sin descripción
      </p>
    );
  }

  const html = renderDocToHtml(doc);
  const canHydrateChecklist = Boolean(canEditChecklist && ticketId && expectedUpdatedAt);

  return (
    <div className="relative">
      <div
        data-rich-text-viewer
        className={cn(
          "prose prose-sm dark:prose-invert max-w-none",
          "prose-headings:font-medium prose-headings:text-emphasis",
          "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
          "prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none",
          "prose-pre:bg-muted prose-pre:text-foreground",
          // taskList styles — el renderer emite `<ul data-task-list>` con
          // `<li data-task-index>` y un `[data-task-item-marker]` vacío que
          // puede quedar tal cual (modo lectura) o recibir un
          // `<input type="checkbox">` real vía portal desde `<TaskItemHydrator>`.
          // El estilo custom del marker (borde + fondo cuando checked) se
          // aplica SOLO si el span está vacío (`:not(:has(*))`), así en modo
          // interactivo no queda duplicado con el input del hidratador.
          "[&_[data-task-list]]:list-none [&_[data-task-list]]:pl-0",
          "[&_[data-task-list]_li]:flex [&_[data-task-list]_li]:items-start [&_[data-task-list]_li]:gap-2",
          "[&_[data-task-list]_li]:my-1",
          "[&_[data-task-item-marker]:not(:has(*))]:mt-0.5 [&_[data-task-item-marker]:not(:has(*))]:inline-block [&_[data-task-item-marker]:not(:has(*))]:size-3.5 [&_[data-task-item-marker]:not(:has(*))]:shrink-0 [&_[data-task-item-marker]:not(:has(*))]:rounded [&_[data-task-item-marker]:not(:has(*))]:border [&_[data-task-item-marker]:not(:has(*))]:border-border",
          "[&_[data-checked='true']_[data-task-item-marker]:not(:has(*))]:bg-primary [&_[data-checked='true']_[data-task-item-marker]:not(:has(*))]:border-primary",
          "[&_[data-checked='true']_[data-task-item-content]]:text-muted-foreground [&_[data-checked='true']_[data-task-item-content]]:line-through",
          "[&_[data-task-item-content]]:min-w-0 [&_[data-task-item-content]_p]:my-0",
          className,
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {canHydrateChecklist && ticketId && expectedUpdatedAt && (
        <TaskItemHydrator
          doc={doc}
          ticketId={ticketId}
          expectedUpdatedAt={expectedUpdatedAt}
        />
      )}
    </div>
  );
}

function isEmptyDoc(doc: ProseMirrorNode): boolean {
  if (doc.type !== "doc") return false;
  const content = doc.content ?? [];
  if (content.length === 0) return true;
  if (content.length !== 1) return false;
  const only = content[0]!;
  if (only.type !== "paragraph") return false;
  const inner = only.content ?? [];
  return inner.length === 0;
}
