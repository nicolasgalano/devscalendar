"use client";

import type { JSONContent } from "@tiptap/react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { TicketComment } from "@/lib/tickets/comments";

import { CommentItem } from "./comment-item";

// Tiptap se importa tarde para no meter ~90 KB en la ruta del detalle si el
// user no llega a escribir un comentario. Mismo pattern que ticket-form-dialog
// para la descripción.
const CommentEditor = dynamic(
  () => import("./comment-editor").then((mod) => mod.CommentEditor),
  {
    ssr: false,
    loading: () => (
      <div className="border-subtle bg-surface min-h-[120px] rounded-md border" aria-hidden="true" />
    ),
  },
);

type TicketCommentsProps = {
  ticketId: string;
  projectId: string;
  projectPmId: string;
  comments: TicketComment[];
  viewer: {
    id: string;
    isAdmin: boolean;
  } | null;
};

export function TicketComments({
  ticketId,
  projectId,
  projectPmId,
  comments,
  viewer,
}: TicketCommentsProps) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitNewComment(doc: JSONContent) {
    setSubmitError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body_doc: doc }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: "Error" }))) as {
          error?: string;
          code?: string;
        };
        if (body.code === "mention_target_invalid") {
          setSubmitError("Mencionaste a alguien que no es miembro activo del proyecto.");
        } else {
          setSubmitError(body.error ?? "No se pudo publicar el comentario");
        }
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pt-6" aria-label="Comentarios">
      <h2 className="text-section pb-3 font-medium">Comentarios</h2>

      {comments.length === 0 ? (
        <p className="text-muted-foreground text-ui pb-3">
          Todavía no hay comentarios. Sé el primero.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 pb-3">
          {comments.map((comment) => (
            <li key={comment.id}>
              {viewer ? (
                <CommentItem
                  comment={comment}
                  ticketId={ticketId}
                  projectId={projectId}
                  projectPmId={projectPmId}
                  viewer={viewer}
                />
              ) : (
                <CommentItem
                  comment={comment}
                  ticketId={ticketId}
                  projectId={projectId}
                  projectPmId={projectPmId}
                  viewer={{ id: "", isAdmin: false }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {viewer ? (
        <>
          <CommentEditor
            projectId={projectId}
            onSubmit={submitNewComment}
            disabled={busy}
          />
          {submitError && (
            <p role="alert" className="text-caption text-destructive pt-2">
              {submitError}
            </p>
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-ui">
          Iniciá sesión para comentar.
        </p>
      )}
    </section>
  );
}
