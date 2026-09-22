"use client";

import type { JSONContent } from "@tiptap/react";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { renderDocToHtml } from "@/lib/editor/render";
import type { ProseMirrorNode } from "@/lib/editor/validate";
import { formatAbsoluteFull, formatRelativeShort } from "@/lib/tickets/relative-time";
import { cn } from "@/lib/utils";

import { CommentEditor } from "./comment-editor";

export type CommentItemViewer = {
  id: string;
  isAdmin: boolean;
};

export type CommentItemData = {
  id: string;
  ticketId: string;
  authorId: string;
  bodyDoc: ProseMirrorNode | null;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    fullName: string | null;
    avatarUrl: string | null;
  };
};

type CommentItemProps = {
  comment: CommentItemData;
  ticketId: string;
  projectId: string;
  projectPmId: string;
  viewer: CommentItemViewer;
};

export function CommentItem({
  comment,
  ticketId,
  projectId,
  projectPmId,
  viewer,
}: CommentItemProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = comment.authorId === viewer.id;
  const canDelete =
    comment.authorId === viewer.id || viewer.isAdmin || projectPmId === viewer.id;

  const isEdited = comment.updatedAt !== comment.createdAt;
  const html = comment.bodyDoc ? renderDocToHtml(comment.bodyDoc) : "";

  async function submitEdit(doc: JSONContent) {
    setError(null);
    const res = await fetch(
      `/api/tickets/${encodeURIComponent(ticketId)}/comments/${encodeURIComponent(comment.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body_doc: doc,
          expected_updated_at: comment.updatedAt,
        }),
      },
    );

    if (res.status === 409) {
      setError("Otra pestaña editó este comentario. Se actualizará con la última versión.");
      router.refresh();
      setEditing(false);
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: "Error" }))) as { error?: string };
      setError(body.error ?? "No se pudo guardar el comentario");
      return;
    }

    setEditing(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm("¿Borrar este comentario?")) return;
    setPending(true);
    setError(null);
    const res = await fetch(
      `/api/tickets/${encodeURIComponent(ticketId)}/comments/${encodeURIComponent(comment.id)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: "Error" }))) as { error?: string };
      setError(body.error ?? "No se pudo borrar el comentario");
      setPending(false);
      return;
    }
    router.refresh();
  }

  if (editing) {
    return (
      <article
        id={`comment-${comment.id}`}
        className="border-subtle rounded-md border p-3"
      >
        <Header comment={comment} isEdited={isEdited} />
        <div className="pt-2">
          <CommentEditor
            projectId={projectId}
            initialDoc={comment.bodyDoc as JSONContent | null}
            onSubmit={submitEdit}
            onCancel={() => {
              setEditing(false);
              setError(null);
            }}
            submitLabel="Guardar"
            autoFocus
          />
          {error && (
            <p role="alert" className="text-caption text-destructive pt-2">
              {error}
            </p>
          )}
        </div>
      </article>
    );
  }

  return (
    <article
      id={`comment-${comment.id}`}
      className={cn(
        "border-subtle rounded-md border p-3",
        pending && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Header comment={comment} isEdited={isEdited} />
        {(canEdit || canDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Opciones del comentario"
                  disabled={pending}
                />
              }
            >
              <MoreHorizontalIcon aria-hidden="true" className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && (
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  Editar
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem onClick={handleDelete}>
                  Borrar
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div
        // ticket-comment: en globals.css desactivamos los checkboxes clickeables
        // de los taskItem — un comentario es histórico, no una lista viva del
        // ticket (spec AC-7.4).
        className="rich-text-viewer ticket-comment pt-2"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {error && (
        <p role="alert" className="text-caption text-destructive pt-2">
          {error}
        </p>
      )}
    </article>
  );
}

function Header({
  comment,
  isEdited,
}: {
  comment: CommentItemData;
  isEdited: boolean;
}) {
  const displayName = comment.author.fullName ?? "Alguien";
  const initial = displayName.slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center gap-2">
      {comment.author.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={comment.author.avatarUrl}
          alt=""
          aria-hidden="true"
          className="size-7 rounded-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="bg-brand-100 text-brand-700 flex size-7 items-center justify-center rounded-full text-xs font-medium"
        >
          {initial}
        </div>
      )}
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-ui text-emphasis font-medium">
          {displayName}
        </span>
        <time
          dateTime={comment.createdAt}
          title={formatAbsoluteFull(comment.createdAt)}
          className="text-caption text-muted-foreground"
        >
          {formatRelativeShort(comment.createdAt)}
        </time>
        {isEdited && (
          <span
            title={formatAbsoluteFull(comment.updatedAt)}
            className="text-caption text-muted-foreground"
          >
            (editado)
          </span>
        )}
      </div>
    </div>
  );
}
