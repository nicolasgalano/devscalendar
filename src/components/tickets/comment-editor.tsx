"use client";

import type { JSONContent } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { createMentionSuggestion } from "@/lib/editor/mention-suggestion";
import { buildRichTextExtensions } from "@/lib/editor/tiptap-extensions";
import { RICH_TEXT_MAX_PLAIN_LENGTH } from "@/lib/validation/rich-text";

// Editor rich text para el feed de comentarios. Reusa las extensiones y el
// schema del `<RichTextEditor>` de 019 (Tiptap + starterKit + mentions), con
// una UI más compacta: sin toolbar (rich text vía atajos de teclado, patrón
// Slack), placeholder "Escribí un comentario…", y Cmd/Ctrl+Enter publica.
//
// Se carga con `dynamic({ ssr: false })` desde `<TicketComments>` para no
// meter Tiptap en la ruta del detalle si nadie termina abriendo la sección.

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

type CommentEditorProps = {
  projectId: string;
  initialDoc?: JSONContent | null;
  onSubmit: (doc: JSONContent) => Promise<void> | void;
  onCancel?: () => void;
  submitLabel?: string;
  autoFocus?: boolean;
  placeholder?: string;
  disabled?: boolean;
};

export function CommentEditor({
  projectId,
  initialDoc,
  onSubmit,
  onCancel,
  submitLabel = "Comentar",
  autoFocus = false,
  placeholder = "Escribí un comentario…",
  disabled = false,
}: CommentEditorProps) {
  const [submitting, setSubmitting] = useState(false);
  // Tiptap no dispara re-render del parent cuando el user tipea; sin este
  // state el contador y el disabled del botón "Comentar" se quedan pegados
  // al valor inicial (0 = disabled). Update lo empuja desde el onUpdate.
  const [plainTextLength, setPlainTextLength] = useState(0);

  const extensions = useMemo(
    () =>
      buildRichTextExtensions({
        placeholder,
        mentionSuggestion: createMentionSuggestion(projectId),
      }),
    [placeholder, projectId],
  );

  // Ref al onSubmit para leer siempre la versión actual desde el handler de
  // keyboard — sin esto, el Cmd/Ctrl+Enter podría capturar una closure vieja.
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  const editor = useEditor({
    extensions,
    content: initialDoc ?? EMPTY_DOC,
    editable: !disabled,
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    onUpdate: ({ editor: e }) => {
      setPlainTextLength(e.getText().length);
    },
    editorProps: {
      attributes: {
        // Estilos alineados con `<RichTextEditor>` de 019 (prose sm), pero
        // con altura mínima menor — un comentario típico es una o dos líneas.
        class: [
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[80px] px-3 py-2",
          "prose-headings:font-medium prose-headings:text-emphasis",
          "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
          "prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none",
          "prose-pre:bg-muted prose-pre:text-foreground",
        ].join(" "),
      },
      handleKeyDown: (_view, event) => {
        // Cmd/Ctrl+Enter publica (spec Q-9, patrón Slack/Linear).
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          void triggerSubmit();
          return true;
        }
        return false;
      },
    },
  });

  // Al montar con initialDoc, sincronizar longitud desde el editor.
  useEffect(() => {
    if (editor) setPlainTextLength(editor.getText().length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  async function triggerSubmit() {
    if (!editor || submitting || disabled) return;
    const doc = editor.getJSON();
    const plainText = editor.getText();
    if (!plainText.trim()) return;
    if (plainText.length > RICH_TEXT_MAX_PLAIN_LENGTH) return;

    setSubmitting(true);
    try {
      await onSubmitRef.current(doc);
      // Solo limpiar cuando es un comentario nuevo — en modo edición, el
      // parent va a desmontar el editor con el nuevo body_doc ya en su lugar.
      if (!initialDoc) {
        editor.commands.setContent(EMPTY_DOC);
        setPlainTextLength(0);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const overCap = plainTextLength > RICH_TEXT_MAX_PLAIN_LENGTH;

  return (
    <div className="border-subtle bg-surface flex flex-col rounded-md border">
      <EditorContent editor={editor} />
      <div className="border-subtle flex items-center justify-between border-t px-3 py-2 text-xs">
        <span className={overCap ? "text-error" : "text-muted-foreground"}>
          {plainTextLength.toLocaleString("es-AR")}
          {overCap ? ` / ${RICH_TEXT_MAX_PLAIN_LENGTH.toLocaleString("es-AR")}` : ""}
        </span>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
              Cancelar
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => void triggerSubmit()}
            disabled={submitting || overCap || plainTextLength === 0 || disabled}
          >
            {submitting ? "Enviando…" : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
