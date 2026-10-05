"use client";

import { ImagePlusIcon, Loader2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useSyncIndicator } from "@/components/sync-indicator";
import { canDeleteAttachment } from "@/lib/attachments/permissions";
import { formatBytes } from "@/lib/attachments/format";
import {
  ATTACHMENT_ACCEPT_ATTR,
  MAX_ATTACHMENT_SIZE_BYTES,
  SOFT_TOTAL_PER_TICKET_BYTES,
} from "@/lib/attachments/types";
import {
  deleteTicketAttachment,
  fetchAttachmentSignedUrl,
  uploadTicketAttachment,
} from "@/lib/attachments/upload";
import type { UserRole } from "@/lib/auth/roles";
import type { TicketAttachmentSummary } from "@/lib/tickets/query";
import { cn } from "@/lib/utils";

/**
 * Panel de adjuntos del detalle de un ticket (feature 020).
 *
 * - Grid responsivo de thumbnails, cada uno pide su URL firmada al montar.
 * - Click en thumb → lightbox con la imagen original (URL firmada aparte).
 * - Upload de uno o varios archivos: valida client, genera thumb, POST
 *   multipart. Cada archivo tiene su propio placeholder mientras sube.
 * - Contador visible al pie con el total usado. Sin bloqueo cuando pasa
 *   50 MB (soft limit).
 * - Borrar disponible solo para el autor + PM primario + admin.
 */

type Viewer = { id: string; roles: UserRole[] } | null;

type ProjectRef = { pm_id: string };

type PendingUpload = {
  clientId: string;    // uuid local para el key del react
  file: File;
  status: "uploading" | "error";
  error?: string;
};

export function TicketAttachmentsPanel({
  ticketId,
  ticketKey,
  attachments: initialAttachments,
  viewer,
  project,
  canUpload,
}: {
  ticketId: string;
  ticketKey: string;
  attachments: TicketAttachmentSummary[];
  viewer: Viewer;
  project: ProjectRef;
  /** Si el viewer puede subir. Se calcula en el server con canUploadAttachment. */
  canUpload: boolean;
}) {
  const router = useRouter();
  const { start } = useSyncIndicator();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const totalBytes = useMemo(
    () => initialAttachments.reduce((acc, a) => acc + a.sizeBytes, 0),
    [initialAttachments],
  );
  const overSoftLimit = totalBytes > SOFT_TOTAL_PER_TICKET_BYTES;

  const openLightbox = useCallback((index: number) => setLightboxIndex(index), []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const goPrev = useCallback(() => {
    setLightboxIndex((current) =>
      current === null ? null : Math.max(0, current - 1),
    );
  }, []);
  const goNext = useCallback(() => {
    setLightboxIndex((current) =>
      current === null ? null : Math.min(initialAttachments.length - 1, current + 1),
    );
  }, [initialAttachments.length]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    // Placeholders para los que van a subir. Los inválidos también los
    // sumamos con `status: error` para que el user vea el motivo.
    const placeholders: PendingUpload[] = files.map((file) => ({
      clientId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      status: "uploading",
    }));
    setPending((current) => [...current, ...placeholders]);

    const stop = start(`Subiendo adjunto${files.length > 1 ? "s" : ""}`);

    await Promise.all(
      placeholders.map(async (placeholder) => {
        const result = await uploadTicketAttachment(ticketId, placeholder.file);
        if (result.ok) {
          // Sacar el placeholder — el refresh trae la fila real.
          setPending((current) =>
            current.filter((p) => p.clientId !== placeholder.clientId),
          );
        } else {
          setPending((current) =>
            current.map((p) =>
              p.clientId === placeholder.clientId
                ? { ...p, status: "error", error: result.error }
                : p,
            ),
          );
        }
      }),
    );

    stop();
    router.refresh();
    // Reset del input para que subir el mismo archivo dos veces seguidas
    // dispare el `change` la segunda vez.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function dismissPendingError(clientId: string) {
    setPending((current) => current.filter((p) => p.clientId !== clientId));
  }

  async function handleDelete(attachment: TicketAttachmentSummary) {
    if (!confirm(`¿Borrar "${attachment.originalFilename}"?`)) return;
    const stop = start("Borrando adjunto");
    try {
      const ok = await deleteTicketAttachment(ticketId, attachment.id);
      if (!ok) {
        alert("No se pudo borrar el adjunto");
        return;
      }
      // Si el lightbox estaba abierto en el que se borra, cerrarlo.
      const currentIndex = initialAttachments.findIndex((a) => a.id === attachment.id);
      if (lightboxIndex === currentIndex) setLightboxIndex(null);
      router.refresh();
    } finally {
      stop();
    }
  }

  const showPanel = initialAttachments.length > 0 || pending.length > 0 || canUpload;
  if (!showPanel) return null;

  return (
    <section className="pt-6">
      <div className="flex items-baseline justify-between pb-3">
        <h2 className="text-section font-medium">Adjuntos</h2>
        <span className={cn("text-caption text-muted-foreground", overSoftLimit && "text-attention")}>
          {formatBytes(totalBytes)} de {formatBytes(SOFT_TOTAL_PER_TICKET_BYTES)}
          {overSoftLimit && " · pasaste el aviso"}
        </span>
      </div>

      {canUpload && (
        <div className="pb-3">
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT_ATTR}
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <ImagePlusIcon aria-hidden="true" />
            Subir imagen
          </Button>
          <span className="text-caption text-muted-foreground ml-3">
            Hasta {formatBytes(MAX_ATTACHMENT_SIZE_BYTES)} por archivo · PNG, JPEG, WebP, GIF
          </span>
        </div>
      )}

      {initialAttachments.length === 0 && pending.length === 0 ? (
        <p className="text-ui text-muted-foreground italic">Sin adjuntos.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {initialAttachments.map((attachment, index) => (
            <ThumbnailCard
              key={attachment.id}
              ticketId={ticketId}
              attachment={attachment}
              onOpen={() => openLightbox(index)}
              onDelete={
                canDeleteAttachment(
                  { uploaded_by: attachment.uploadedById },
                  viewer,
                  project,
                )
                  ? () => handleDelete(attachment)
                  : undefined
              }
            />
          ))}
          {pending.map((placeholder) => (
            <PendingCard
              key={placeholder.clientId}
              placeholder={placeholder}
              onDismiss={() => dismissPendingError(placeholder.clientId)}
            />
          ))}
        </div>
      )}

      {lightboxIndex !== null && initialAttachments[lightboxIndex] && (
        <Lightbox
          ticketId={ticketId}
          ticketKey={ticketKey}
          attachment={initialAttachments[lightboxIndex]!}
          hasPrev={lightboxIndex > 0}
          hasNext={lightboxIndex < initialAttachments.length - 1}
          onClose={closeLightbox}
          onPrev={goPrev}
          onNext={goNext}
        />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// ThumbnailCard
// ─────────────────────────────────────────────────────────────

function ThumbnailCard({
  ticketId,
  attachment,
  onOpen,
  onDelete,
}: {
  ticketId: string;
  attachment: TicketAttachmentSummary;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAttachmentSignedUrl(ticketId, attachment.id, "thumb").then((url) => {
      if (!cancelled) setSignedUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [ticketId, attachment.id]);

  return (
    <div className="group border-border bg-surface relative overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={onOpen}
        className="focus-visible:outline-ring block w-full outline-none focus-visible:outline-2"
        style={{ aspectRatio: `${attachment.width} / ${attachment.height}` }}
        aria-label={`Ver ${attachment.originalFilename}`}
      >
        {signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL de Supabase Storage con expiración, next/image no encaja con URLs dinámicas
          <img
            src={signedUrl}
            alt={attachment.originalFilename}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Loader2Icon className="text-muted-foreground size-4 animate-spin" aria-hidden="true" />
          </div>
        )}
      </button>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Borrar ${attachment.originalFilename}`}
          className="bg-background/80 text-muted-foreground hover:bg-background hover:text-danger absolute top-1 right-1 hidden size-6 items-center justify-center rounded-md backdrop-blur-sm group-hover:flex focus-visible:flex"
        >
          <XIcon className="size-3.5" />
        </button>
      )}

      <div className="border-border border-t px-2 py-1.5">
        <p className="text-caption truncate" title={attachment.originalFilename}>
          {attachment.originalFilename}
        </p>
        <p className="text-caption text-muted-foreground">
          {formatBytes(attachment.sizeBytes)}
          {attachment.uploadedByName && ` · ${attachment.uploadedByName}`}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PendingCard (placeholder mientras sube o falló)
// ─────────────────────────────────────────────────────────────

function PendingCard({
  placeholder,
  onDismiss,
}: {
  placeholder: PendingUpload;
  onDismiss: () => void;
}) {
  return (
    <div
      className={cn(
        "border-border bg-surface flex aspect-square flex-col items-center justify-center rounded-md border p-3",
        placeholder.status === "error" && "border-danger/40",
      )}
    >
      {placeholder.status === "uploading" ? (
        <>
          <Loader2Icon className="text-muted-foreground size-4 animate-spin" aria-hidden="true" />
          <p className="text-caption text-muted-foreground mt-2 truncate text-center">
            Subiendo {placeholder.file.name}…
          </p>
        </>
      ) : (
        <>
          <p className="text-caption text-danger text-center">
            {placeholder.error ?? "Error al subir"}
          </p>
          <p className="text-caption text-muted-foreground mt-1 truncate text-center">
            {placeholder.file.name}
          </p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={onDismiss}>
            Descartar
          </Button>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Lightbox
// ─────────────────────────────────────────────────────────────

function Lightbox({
  ticketId,
  ticketKey,
  attachment,
  hasPrev,
  hasNext,
  onClose,
  onPrev,
  onNext,
}: {
  ticketId: string;
  ticketKey: string;
  attachment: TicketAttachmentSummary;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSignedUrl(null);
    fetchAttachmentSignedUrl(ticketId, attachment.id, "original").then((url) => {
      if (!cancelled) setSignedUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [ticketId, attachment.id]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && hasPrev) onPrev();
      else if (event.key === "ArrowRight" && hasNext) onNext();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [hasPrev, hasNext, onClose, onPrev, onNext]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Vista ampliada de ${attachment.originalFilename}`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="text-background/80 hover:text-background absolute top-4 right-4"
      >
        <XIcon className="size-6" />
      </button>

      {hasPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          aria-label="Anterior"
          className="text-background/80 hover:text-background absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-light"
        >
          ‹
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          aria-label="Siguiente"
          className="text-background/80 hover:text-background absolute right-4 top-1/2 -translate-y-1/2 text-2xl font-light"
        >
          ›
        </button>
      )}

      <div
        className="max-h-full max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- ver ThumbnailCard
          <img
            src={signedUrl}
            alt={attachment.originalFilename}
            className="max-h-[85vh] max-w-full object-contain"
          />
        ) : (
          <Loader2Icon className="text-background size-8 animate-spin" aria-hidden="true" />
        )}
        <p className="text-background/70 text-caption mt-2 text-center">
          {attachment.originalFilename} · {formatBytes(attachment.sizeBytes)} · {ticketKey}
        </p>
      </div>
    </div>
  );
}
