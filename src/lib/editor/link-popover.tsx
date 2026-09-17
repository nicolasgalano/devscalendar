"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { LINK_PROTOCOLS } from "./schema";

type LinkPopoverProps = {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};

// Popover para agregar/editar un link en el editor. Se ancla al botón de la
// toolbar (por eso recibe `trigger` como children — el llamador decide cómo
// se ve el botón). El open lo controla el `<RichTextEditor>` porque además
// del click también responde a Cmd/Ctrl+K desde el editor.
//
// Comportamiento:
// - Al abrir, si la selección ya tiene un mark `link`, prefilla los inputs
//   con `href` y con el texto seleccionado.
// - "Aplicar" queda disabled si la URL no valida (whitelist de protocolos).
// - Si hay selección: envuelve la selección con el link.
// - Si no hay selección: inserta el texto ingresado como texto plano con el
//   link mark aplicado. Si el usuario dejó el campo texto en blanco, usa la
//   URL como texto visible (fallback razonable).
// - "Quitar" aparece solo si la selección ya es un link.

export function LinkPopover({ editor, open, onOpenChange, children }: LinkPopoverProps) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");

  const isEditingExistingLink = editor.isActive("link");

  useEffect(() => {
    if (!open) return;
    const existingHref = editor.getAttributes("link").href as string | undefined;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    setText(selectedText);
    setUrl(existingHref ?? "");
  }, [open, editor]);

  const urlIsValid = useMemo(() => isValidHref(url), [url]);

  function apply() {
    if (!urlIsValid) return;
    const trimmedText = text.trim();
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;

    if (hasSelection) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    } else {
      const displayText = trimmedText.length > 0 ? trimmedText : url;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: displayText,
          marks: [{ type: "link", attrs: { href: url } }],
        })
        .run();
    }

    onOpenChange(false);
  }

  function removeLink() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80"
        onKeyDown={(event) => {
          if (event.key === "Enter" && urlIsValid) {
            event.preventDefault();
            apply();
          }
        }}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-popover-text" className="text-xs">
              Texto
            </Label>
            <Input
              id="link-popover-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Texto a mostrar (opcional)"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-popover-url" className="text-xs">
              URL
            </Label>
            <Input
              id="link-popover-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://ejemplo.com"
            />
            {!urlIsValid && url.length > 0 && (
              <span className="text-attention text-xs">
                Protocolo no permitido. Usá {LINK_PROTOCOLS.join(", ")}.
              </span>
            )}
          </div>

          <div className="flex justify-end gap-2">
            {isEditingExistingLink && (
              <Button variant="ghost" size="sm" onClick={removeLink}>
                Quitar
              </Button>
            )}
            <Button size="sm" disabled={!urlIsValid} onClick={apply}>
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function isValidHref(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const match = /^([a-z][a-z0-9+\-.]*):/i.exec(trimmed);
  if (!match) return false;
  const protocol = match[1]!.toLowerCase();
  return (LINK_PROTOCOLS as readonly string[]).includes(protocol);
}
