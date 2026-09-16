"use client";

import { useRef, useState } from "react";
import { BoldIcon, ItalicIcon, LinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { MarkdownViewer } from "./viewer";

type Mode = "write" | "preview";

/**
 * Editor de markdown para descripciones de tickets. Textarea + tabs "Escribir /
 * Vista previa" (sin WYSIWYG) + mini-toolbar de tres acciones (`bold`,
 * `italic`, `link`) que insertan la sintaxis alrededor del texto seleccionado.
 *
 * La UX es a propósito minimalista: los devs escriben markdown a mano y los
 * no-devs usan los tres botones. Si mañana hace falta más, se agrega — pero un
 * editor rico agrega peso y complejidad que no justifica un `title + 3 líneas`
 * medio.
 *
 * Vive como Client Component porque el estado (modo, focus, selección del
 * textarea) es puramente cliente. El viewer que muestra la preview es
 * server-safe pero se importa igual — al ser client component, todo su árbol
 * corre en el cliente, y eso está bien: la preview no vuelve al server.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  maxLength = 10_000,
  minRows = 4,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  minRows?: number;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>("write");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function wrapSelection(prefix: string, suffix: string = prefix): void {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);
    const next = `${before}${prefix}${selected}${suffix}${after}`;

    if (next.length > maxLength) return;

    onChange(next);
    // Restaurar la posición del cursor / selección después del re-render.
    requestAnimationFrame(() => {
      textarea.focus();
      const newStart = start + prefix.length;
      const newEnd = end + prefix.length;
      textarea.setSelectionRange(newStart, newEnd);
    });
  }

  function insertLink(): void {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || "texto del link";
    // Cursor al final, dentro de los paréntesis, para que el usuario escriba
    // la URL a continuación.
    const inserted = `[${selected}](url)`;
    const next = `${value.slice(0, start)}${inserted}${value.slice(end)}`;
    if (next.length > maxLength) return;
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const urlStart = start + selected.length + 3; // "[texto](" length
      textarea.setSelectionRange(urlStart, urlStart + 3);
    });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="border-border inline-flex rounded-md border p-0.5">
          <button
            type="button"
            onClick={() => setMode("write")}
            className={cn(
              "text-ui rounded px-2.5 py-1 transition-colors",
              mode === "write"
                ? "bg-muted text-emphasis"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Escribir
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={cn(
              "text-ui rounded px-2.5 py-1 transition-colors",
              mode === "preview"
                ? "bg-muted text-emphasis"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Vista previa
          </button>
        </div>

        {mode === "write" && (
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => wrapSelection("**")}
              aria-label="Negrita"
              title="Negrita"
            >
              <BoldIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => wrapSelection("_")}
              aria-label="Cursiva"
              title="Cursiva"
            >
              <ItalicIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={insertLink}
              aria-label="Insertar link"
              title="Insertar link"
            >
              <LinkIcon className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {mode === "write" ? (
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (next.length <= maxLength) onChange(next);
          }}
          placeholder={placeholder}
          rows={minRows}
          className="font-mono text-xs"
        />
      ) : (
        <div className="border-border min-h-20 rounded-lg border px-2.5 py-2">
          <MarkdownViewer content={value} />
        </div>
      )}

      <div className="text-muted-foreground text-right text-xs">
        {value.length} / {maxLength.toLocaleString("es-AR")}
      </div>
    </div>
  );
}
