"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import {
  Bold,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Redo,
  Undo,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { LinkPopover } from "./link-popover";
import { createMentionSuggestion } from "./mention-suggestion";
import { sanitizePastedHtml } from "./paste";
import { buildRichTextExtensions } from "./tiptap-extensions";

// El único cliente del editor rich text de 019. El `<TicketFormDialog>` lo
// carga con `dynamic(() => ..., { ssr: false })` para no sumar el bundle de
// Tiptap + ProseMirror + lowlight (~90KB gzipped) a la ruta del detalle de
// ticket, donde no hace falta editar.
//
// Contrato con el llamador:
// - `value` es el doc de ProseMirror que hoy tiene el ticket, o `null` (crea
//   uno vacío internamente). Los cambios se comunican por `onChange(doc, plainText)`.
// - `onDirtyChange(dirty)` se dispara cuando el doc actual difiere del `initial`
//   original — el llamador lo usa para saber si hay que mostrar el
//   `<ConfirmDiscardDialog>` al cancelar (Q-6 del spec).
// - `maxPlainTextLength` corta la escritura: si el próximo update pasaría el
//   cap, se revierte con `editor.commands.undo()`. No hay toast — la tecla
//   simplemente deja de ingresar. El contador al pie es la señal visual.

export const DEFAULT_MAX_PLAIN_TEXT_LENGTH = 10_000;

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

type RichTextEditorProps = {
  value: JSONContent | null;
  onChange: (doc: JSONContent, plainText: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  placeholder?: string;
  maxPlainTextLength?: number;
  disabled?: boolean;
  // 022. Si se pasa, el editor cablea el autocompletado de `@` mention contra
  // `/api/projects/[projectId]/members`. Sin `projectId`, la extensión Mention
  // queda montada pero sin sugerencias — sirve para mostrar mentions existentes
  // en modo lectura o en un futuro editor descontextualizado.
  projectId?: string;
};

export function RichTextEditor({
  value,
  onChange,
  onDirtyChange,
  placeholder,
  maxPlainTextLength = DEFAULT_MAX_PLAIN_TEXT_LENGTH,
  disabled = false,
  projectId,
}: RichTextEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [plainTextLength, setPlainTextLength] = useState(0);

  const extensions = useMemo(
    () =>
      buildRichTextExtensions({
        placeholder,
        mentionSuggestion: projectId ? createMentionSuggestion(projectId) : undefined,
      }),
    [placeholder, projectId],
  );

  const initialDocRef = useRef<string>(JSON.stringify(value ?? EMPTY_DOC));

  const onChangeRef = useRef(onChange);
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onChangeRef.current = onChange;
    onDirtyChangeRef.current = onDirtyChange;
  }, [onChange, onDirtyChange]);

  const editor = useEditor({
    extensions,
    content: value ?? EMPTY_DOC,
    editable: !disabled,
    // Next.js 15 hidrata en cliente; sin esto el editor tira warning por
    // mismatch de SSR (aun cuando el componente que lo usa esté en dynamic
    // con ssr:false, Tiptap lo chequea igual).
    immediatelyRender: false,
    editorProps: {
      transformPastedHTML: (html) => sanitizePastedHtml(html),
      attributes: {
        // Mismos modifiers `prose-*` que `<RichTextViewer>` para que el usuario
        // vea idéntico lo que edita y lo que después lee (mitigación de R-4).
        // Cualquier cambio a esta lista tiene que replicarse en viewer.
        class: [
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[200px] p-3",
          "prose-headings:font-medium prose-headings:text-emphasis",
          "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
          "prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none",
          "prose-pre:bg-muted prose-pre:text-foreground",
          // TaskList styles del editor — Tiptap emite `<ul data-type="taskList">`
          // con hijos `<li data-checked="...">` que ya traen su propio
          // `<input type="checkbox">`. Sin `list-none` los `<li>` heredan el
          // bullet de `.prose` y quedan con dos marcadores (bullet + checkbox).
          "[&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:pl-0",
          "[&_ul[data-type='taskList']_li]:flex [&_ul[data-type='taskList']_li]:items-start [&_ul[data-type='taskList']_li]:gap-2 [&_ul[data-type='taskList']_li]:my-1",
          "[&_ul[data-type='taskList']_li>label]:mt-1 [&_ul[data-type='taskList']_li>label]:flex-none",
          "[&_ul[data-type='taskList']_li>div]:min-w-0 [&_ul[data-type='taskList']_li>div>p]:my-0",
        ].join(" "),
      },
    },
    onUpdate: ({ editor: current }) => {
      const plainText = current.getText();

      if (plainText.length > maxPlainTextLength) {
        // El hard-limit vive acá y no en el schema del validador — este
        // camino ataja al escribir; el validador ataja al pegar/enviar. El
        // undo revierte la última transacción (el keystroke que se pasó),
        // así el usuario no se traba: si sigue escribiendo, sigue rebotando.
        current.commands.undo();
        return;
      }

      setPlainTextLength(plainText.length);

      const doc = current.getJSON();
      onChangeRef.current(doc, plainText);

      const dirty = JSON.stringify(doc) !== initialDocRef.current;
      onDirtyChangeRef.current?.(dirty);
    },
  });

  // Cmd/Ctrl+K abre el popover de link. Se registra sobre el DOM del editor
  // porque Tiptap no ofrece un slot declarativo para atajos que sean UX del
  // wrapper (no comandos del editor).
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setLinkOpen(true);
      }
    }
    dom.addEventListener("keydown", handleKeyDown);
    return () => dom.removeEventListener("keydown", handleKeyDown);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable === disabled) {
      editor.setEditable(!disabled);
    }
  }, [editor, disabled]);

  // Inicializar el contador cuando el editor termina de crear el doc.
  useEffect(() => {
    if (!editor) return;
    setPlainTextLength(editor.getText().length);
  }, [editor]);

  if (!editor) {
    return <EditorSkeleton />;
  }

  const counterTone = counterColor(plainTextLength, maxPlainTextLength);

  return (
    <div
      className={cn(
        "border-border bg-background flex flex-col overflow-hidden rounded-md border",
        disabled && "opacity-60",
      )}
    >
      <Toolbar editor={editor} linkOpen={linkOpen} onLinkOpenChange={setLinkOpen} disabled={disabled} />
      <EditorContent editor={editor} />
      <div className="border-border text-muted-foreground flex items-center justify-end border-t px-3 py-1.5 text-xs">
        <span className={counterTone}>
          {plainTextLength.toLocaleString("es-AR")} / {maxPlainTextLength.toLocaleString("es-AR")}
        </span>
      </div>
    </div>
  );
}

function counterColor(current: number, max: number): string {
  const ratio = current / max;
  if (ratio >= 1) return "text-attention font-medium";
  if (ratio >= 0.9) return "text-attention";
  return "";
}

// ─────────────────────────────────────────────────────────────
// Toolbar
// ─────────────────────────────────────────────────────────────

type ToolbarProps = {
  editor: Editor;
  linkOpen: boolean;
  onLinkOpenChange: (open: boolean) => void;
  disabled: boolean;
};

function Toolbar({ editor, linkOpen, onLinkOpenChange, disabled }: ToolbarProps) {
  const isActive = useCallback(
    (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs),
    [editor],
  );

  return (
    <div className="border-border bg-surface sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b p-1">
      <ToolbarButton
        label="Negrita (Ctrl+B)"
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={isActive("bold")}
        disabled={disabled}
      >
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Cursiva (Ctrl+I)"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={isActive("italic")}
        disabled={disabled}
      >
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Código inline (Ctrl+E)"
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={isActive("code")}
        disabled={disabled}
      >
        <Code className="size-4" />
      </ToolbarButton>

      <Separator />

      <ToolbarButton
        label="Título 1"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={isActive("heading", { level: 1 })}
        disabled={disabled}
      >
        <Heading1 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Título 2"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={isActive("heading", { level: 2 })}
        disabled={disabled}
      >
        <Heading2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Título 3"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={isActive("heading", { level: 3 })}
        disabled={disabled}
      >
        <Heading3 className="size-4" />
      </ToolbarButton>

      <Separator />

      <ToolbarButton
        label="Lista con viñetas"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={isActive("bulletList")}
        disabled={disabled}
      >
        <List className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Lista numerada"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={isActive("orderedList")}
        disabled={disabled}
      >
        <ListOrdered className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Checklist"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        active={isActive("taskList")}
        disabled={disabled}
      >
        <ListTodo className="size-4" />
      </ToolbarButton>

      <Separator />

      <ToolbarButton
        label="Cita"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={isActive("blockquote")}
        disabled={disabled}
      >
        <Quote className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Bloque de código"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={isActive("codeBlock")}
        disabled={disabled}
      >
        <Code2 className="size-4" />
      </ToolbarButton>

      <Separator />

      <LinkPopover editor={editor} open={linkOpen} onOpenChange={onLinkOpenChange}>
        {/* Sin `onClick` propio: Base UI hace compose y su handler abre/cierra
             el popover automáticamente. Un onClick extra pelearía con el toggle. */}
        <ToolbarButton label="Link (Ctrl+K)" active={isActive("link")} disabled={disabled}>
          <LinkIcon className="size-4" />
        </ToolbarButton>
      </LinkPopover>

      <div className="ml-auto flex items-center gap-0.5">
        <ToolbarButton
          label="Deshacer (Ctrl+Z)"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={disabled || !editor.can().undo()}
        >
          <Undo className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Rehacer (Ctrl+Shift+Z)"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={disabled || !editor.can().redo()}
        >
          <Redo className="size-4" />
        </ToolbarButton>
      </div>
    </div>
  );
}

type ToolbarButtonProps = {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
};

function ToolbarButton({ label, onClick, active, disabled, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-ring inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:outline-2 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
        active && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <div className="bg-border mx-1 h-5 w-px" role="presentation" />;
}

// ─────────────────────────────────────────────────────────────
// Skeleton para cuando el editor todavía no se hidrató
// ─────────────────────────────────────────────────────────────

export function EditorSkeleton() {
  return (
    <div className="border-border bg-background flex flex-col overflow-hidden rounded-md border">
      <div className="border-border bg-surface sticky top-0 z-10 h-10 border-b" />
      <div className="min-h-[200px] p-3">
        <div className="text-muted-foreground text-ui">Cargando editor…</div>
      </div>
      <div className="border-border h-6 border-t" />
    </div>
  );
}
