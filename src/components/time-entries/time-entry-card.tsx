"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PencilIcon, Trash2Icon, UserIcon } from "lucide-react";

import { useSyncIndicator } from "@/components/sync-indicator";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UserRole } from "@/lib/auth/roles";
import { formatMinutesVerbose } from "@/lib/time-entries/format";
import { canEditTimeEntry } from "@/lib/time-entries/permissions";
import type { TimeEntryListItem } from "@/lib/time-entries/query";
import { cn } from "@/lib/utils";

/**
 * Card de una time entry — se apila dentro de la columna del día en Mi Tiempo,
 * y también en la sección "Horas cargadas" del ticket.
 *
 * Comportamiento del click:
 *   - Si hay ticket, el título linkea al ticket.
 *   - Si no, click en la card abre edit (si tenés permiso) — sino no hace nada.
 *   - Los botones de edit/delete aparecen al hover, solo si `canEditTimeEntry`.
 */
export function TimeEntryCard({
  entry,
  viewer,
  onEdit,
}: {
  entry: TimeEntryListItem;
  viewer: { id: string; roles: UserRole[] } | null;
  onEdit?: (entry: TimeEntryListItem) => void;
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = canEditTimeEntry(viewer, {
    user_id: entry.userId,
    logged_at: entry.loggedAt,
  });
  const isProxy = entry.createdBy !== null && entry.createdBy !== entry.userId;

  async function performDelete() {
    setError(null);
    const stop = startSync("Borrando carga");
    try {
      const res = await fetch(`/api/time-entries/${entry.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        setError(body.error ?? "No se pudo borrar.");
        return;
      }
      setConfirmingDelete(false);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      stop();
    }
  }

  const ticketKey = entry.ticket
    ? `${entry.project.key}-${entry.ticket.numero}`
    : null;

  return (
    <>
      <div
        className={cn(
          "group border-border bg-background flex flex-col gap-1 rounded-md border p-2",
          "hover:border-border-strong transition-colors",
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          {ticketKey ? (
            <Link
              href={`/tickets/${ticketKey}`}
              className="font-data text-caption text-primary hover:underline"
            >
              {ticketKey}
            </Link>
          ) : (
            <span className="text-caption text-muted-foreground">Sin ticket</span>
          )}
          <span className="font-data text-caption text-foreground">
            {formatMinutesVerbose(entry.minutes)}
          </span>
        </div>

        <p className="text-ui text-foreground leading-tight">
          {entry.activity?.name ?? (
            <span className="text-muted-foreground italic">
              {entry.project.name}
            </span>
          )}
        </p>

        {entry.description && (
          <p className="text-caption text-muted-foreground line-clamp-2">
            {entry.description}
          </p>
        )}

        <div className="flex items-center justify-between">
          {isProxy && (
            <span className="text-caption text-muted-foreground inline-flex items-center gap-1">
              <UserIcon aria-hidden="true" className="size-3" />
              por {entry.createdByName ?? "otro"}
            </span>
          )}
          {canEdit && (
            <div className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100">
              {onEdit && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onEdit(entry)}
                  aria-label="Editar"
                  title="Editar"
                >
                  <PencilIcon aria-hidden="true" className="size-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setConfirmingDelete(true)}
                aria-label="Borrar"
                title="Borrar"
                className="text-destructive"
              >
                <Trash2Icon aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Borrar carga</DialogTitle>
            <DialogDescription>
              Vas a borrar {formatMinutesVerbose(entry.minutes)} del {entry.loggedAt}
              {ticketKey ? ` sobre ${ticketKey}` : ` sobre ${entry.project.name}`}.
              No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-ui text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={performDelete}>
              Borrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
