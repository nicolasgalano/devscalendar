"use client";

import { useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";

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
import { formatMinutesVerbose, formatMinutesDecimal } from "@/lib/time-entries/format";
import { canEditTimeEntry } from "@/lib/time-entries/permissions";
import type { TimeEntryListItem } from "@/lib/time-entries/query";
import { formatAbsoluteFull, formatRelativeShort } from "@/lib/tickets/relative-time";
import { cn } from "@/lib/utils";

import {
  TimeEntryDialog,
  type TimeEntryActivity,
  type TimeEntryDialogInitial,
  type TimeEntryProject,
} from "./time-entry-dialog";

/**
 * Sección "Horas cargadas" en el detalle del ticket (016 T5.1).
 * Header con total (y comparación con `estimated_hours` si aplica).
 * Lista compacta de entries del ticket con inline edit/delete.
 */
export function TicketTimeEntries({
  ticketId,
  ticketKey,
  ticketTitle,
  project,
  activities,
  estimatedHours,
  entries,
  viewer,
  canLog,
}: {
  ticketId: string;
  ticketKey: string;
  ticketTitle: string;
  project: TimeEntryProject;
  activities: TimeEntryActivity[];
  estimatedHours: number | null;
  entries: TimeEntryListItem[];
  viewer: { id: string; roles: UserRole[] } | null;
  canLog: boolean;
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [dialogState, setDialogState] = useState<
    | { open: false }
    | { open: true; mode: "create" }
    | { open: true; mode: "edit"; entry: TimeEntryListItem }
  >({ open: false });
  const [deleting, setDeleting] = useState<TimeEntryListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalMinutes = entries.reduce((acc, e) => acc + e.minutes, 0);
  const estimatedMinutes = estimatedHours !== null ? estimatedHours * 60 : null;
  const pct =
    estimatedMinutes && estimatedMinutes > 0
      ? Math.round((totalMinutes / estimatedMinutes) * 100)
      : null;

  async function performDelete() {
    if (!deleting) return;
    setError(null);
    const stop = startSync("Borrando carga");
    try {
      const res = await fetch(`/api/time-entries/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "No se pudo borrar la carga.");
        return;
      }
      setDeleting(null);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      stop();
    }
  }

  const createInitial: TimeEntryDialogInitial = {
    projectId: project.id,
    ticketId,
    activityId: null,
    minutes: 60,
    loggedAt: new Date().toISOString().slice(0, 10),
    description: "",
  };

  const editInitial: TimeEntryDialogInitial =
    dialogState.open && dialogState.mode === "edit"
      ? {
          id: dialogState.entry.id,
          projectId: dialogState.entry.project.id,
          ticketId: dialogState.entry.ticket?.id ?? null,
          activityId: dialogState.entry.activity?.id ?? null,
          minutes: dialogState.entry.minutes,
          loggedAt: dialogState.entry.loggedAt,
          description: dialogState.entry.description ?? "",
        }
      : createInitial;

  const ticketsByProject = {
    [project.id]: [{ id: ticketId, key: ticketKey, title: ticketTitle }],
  };

  return (
    <section className="pt-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-section font-medium">Horas cargadas</h2>
          {totalMinutes > 0 && (
            <p className="text-caption text-muted-foreground mt-0.5">
              Total:{" "}
              <span className="font-data text-foreground">
                {formatMinutesDecimal(totalMinutes)}
              </span>
              {estimatedHours !== null && (
                <>
                  {" · "}
                  <span className="font-data">{estimatedHours}h</span> estimadas
                  {pct !== null && (
                    <>
                      {" · "}
                      <span className={cn("font-data", pct > 100 && "text-attention")}>
                        {pct}%
                      </span>
                    </>
                  )}
                </>
              )}
            </p>
          )}
        </div>
        {canLog && (
          <Button size="sm" onClick={() => setDialogState({ open: true, mode: "create" })}>
            <PlusIcon aria-hidden="true" />
            Cargar tiempo
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-ui text-destructive mb-3">
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="text-ui text-muted-foreground italic">
          Todavía no hay tiempo cargado sobre este ticket.
        </p>
      ) : (
        <ul className="border-border flex flex-col divide-y divide-border rounded-md border">
          {entries.map((entry) => {
            const canModify = canEditTimeEntry(viewer, {
              user_id: entry.userId,
              logged_at: entry.loggedAt,
            });
            return (
              <li
                key={entry.id}
                className="group flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2"
              >
                <time
                  title={formatAbsoluteFull(entry.loggedAt)}
                  className="font-data text-caption text-muted-foreground w-20 shrink-0"
                >
                  {formatRelativeShort(entry.loggedAt)}
                </time>
                <span className="text-ui text-foreground w-36 shrink-0 truncate">
                  {entry.userName}
                </span>
                <span className="font-data text-emphasis w-16 shrink-0">
                  {formatMinutesVerbose(entry.minutes)}
                </span>
                {entry.activity && (
                  <span className="text-caption text-secondary-foreground w-28 shrink-0 truncate">
                    {entry.activity.name}
                  </span>
                )}
                {entry.description && (
                  <p className="text-caption text-muted-foreground min-w-0 flex-1">
                    {entry.description}
                  </p>
                )}
                {canModify && (
                  <div className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDialogState({ open: true, mode: "edit", entry })}
                      aria-label="Editar"
                      title="Editar"
                    >
                      <PencilIcon aria-hidden="true" className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleting(entry)}
                      aria-label="Borrar"
                      title="Borrar"
                      className="text-destructive"
                    >
                      <Trash2Icon aria-hidden="true" className="size-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <TimeEntryDialog
        mode="create"
        open={dialogState.open && dialogState.mode === "create"}
        onOpenChange={(next) => !next && setDialogState({ open: false })}
        initial={createInitial}
        projects={[project]}
        activitiesByProject={{ [project.id]: activities }}
        ticketsByProject={ticketsByProject}
      />
      <TimeEntryDialog
        mode="edit"
        open={dialogState.open && dialogState.mode === "edit"}
        onOpenChange={(next) => !next && setDialogState({ open: false })}
        initial={editInitial}
        projects={[project]}
        activitiesByProject={{ [project.id]: activities }}
        ticketsByProject={ticketsByProject}
      />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Borrar carga</DialogTitle>
            <DialogDescription>
              Vas a borrar{" "}
              {deleting ? formatMinutesVerbose(deleting.minutes) : ""} del{" "}
              {deleting?.loggedAt} sobre {ticketKey}. No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={performDelete}>
              Borrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
