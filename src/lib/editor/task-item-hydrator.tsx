"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useSyncIndicator } from "@/components/sync-indicator";

import type { ProseMirrorNode } from "./validate";

// Convierte los `<span data-task-item-marker>` que emite `renderDocToHtml` en
// checkboxes interactivos. Se monta como hermano del `<RichTextViewer>`
// (mismo padre `relative`) y usa portales para meter un input dentro de cada
// marker sin pisar el HTML server-rendered.
//
// Por qué portales y no manipulación imperativa del DOM: React necesita
// tener el checkbox bajo su árbol para que el `checked` reactive y el
// `onChange` dispatchee. Con `createPortal` React "adopta" el nodo destino
// (el `span[data-task-item-marker]`) y lo trata como parte de su árbol.
//
// Por qué `router.refresh()` en 200/409 y no un `useOptimistic`: el `doc` es
// server-rendered adentro del `<RichTextViewer>` (server component). Un
// optimistic update local no ve el HTML — habría que rerenderar el server
// component, y para eso Next necesita el refresh. En la práctica, cambiar
// un checkbox y ver el estado ~200ms después es aceptable; una carga de
// checklist entera con 10 items marcándose no es un caso real.

type TaskItemHydratorProps = {
  doc: ProseMirrorNode;
  ticketId: string;
  expectedUpdatedAt: string;
};

type TaskItemInfo = {
  path: number[];
  checked: boolean;
};

export function TaskItemHydrator({ doc, ticketId, expectedUpdatedAt }: TaskItemHydratorProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [markers, setMarkers] = useState<Element[]>([]);
  const router = useRouter();
  const { start } = useSyncIndicator();

  const items = useMemo(() => collectTaskItems(doc), [doc]);

  useEffect(() => {
    // Encuentra el viewer hermano y sus markers. Corre después de que el
    // server pintó el HTML — como el hidratador vive como hermano del viewer,
    // el `parentElement` es el wrapper `relative` del `<RichTextViewer>`.
    const anchor = anchorRef.current;
    if (!anchor) return;
    const parent = anchor.parentElement;
    if (!parent) return;
    const viewer = parent.querySelector("[data-rich-text-viewer]");
    if (!viewer) return;
    const found = Array.from(viewer.querySelectorAll("span[data-task-item-marker]"));
    setMarkers(found);
  }, [doc]);

  async function toggle(index: number) {
    const item = items[index];
    if (!item) return;

    const stop = start("Actualizando checklist");
    try {
      const mutated = toggleCheckedAtPath(doc, item.path);
      await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description_doc: mutated,
          expected_updated_at: expectedUpdatedAt,
        }),
      });
      // En 200 el server ya escribió; el refresh reobtiene el doc.
      // En 409 el ticket cambió entre la lectura y esta escritura; el
      // refresh trae el nuevo estado y el usuario puede reintentar.
      // Otros errores caen a refresh también — silencio deliberado en el edge
      // case, para no meter un toast en un click que ya se sintió instantáneo.
      router.refresh();
    } finally {
      stop();
    }
  }

  return (
    <>
      <span ref={anchorRef} data-hydrator-anchor className="hidden" aria-hidden="true" />
      {markers.map((marker, i) => {
        const item = items[i];
        if (!item) return null;
        return createPortal(
          <input
            type="checkbox"
            checked={item.checked}
            onChange={() => toggle(i)}
            className="cursor-pointer"
            aria-label="Cambiar estado del ítem"
          />,
          marker,
          `task-${i}`,
        );
      })}
    </>
  );
}

// Recorre el doc en DFS pre-order colectando cada `taskItem` con el `path`
// que le llega desde `doc.content`. El path se usa para (a) mutar en
// `toggleCheckedAtPath` sin tener que reencontrar el nodo y (b) alinear el
// checkbox del portal con el `data-task-index` que emite el renderer, que
// también es DFS pre-order.
function collectTaskItems(
  node: ProseMirrorNode,
  path: number[] = [],
  out: TaskItemInfo[] = [],
): TaskItemInfo[] {
  if (node.type === "taskItem") {
    out.push({ path: [...path], checked: node.attrs?.checked === true });
  }
  const children = node.content ?? [];
  for (let i = 0; i < children.length; i++) {
    collectTaskItems(children[i]!, [...path, i], out);
  }
  return out;
}

function toggleCheckedAtPath(doc: ProseMirrorNode, path: number[]): ProseMirrorNode {
  const clone = JSON.parse(JSON.stringify(doc)) as ProseMirrorNode;
  let cursor: ProseMirrorNode = clone;
  for (const idx of path) {
    const next = cursor.content?.[idx];
    if (!next) return clone;
    cursor = next;
  }
  const currentChecked = cursor.attrs?.checked === true;
  cursor.attrs = { ...(cursor.attrs ?? {}), checked: !currentChecked };
  return clone;
}
