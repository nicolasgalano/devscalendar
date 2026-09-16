"use client";

import { useState } from "react";
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
import type { SprintListItem } from "@/lib/sprints/query";
import { formatSprintDisplayName } from "@/lib/sprints/status";

import { SprintFormDialog } from "./sprint-form-dialog";

/**
 * Dialog de cierre de sprint (018 T4.6). Tres estados según el resultado del
 * preflight que hace `<SprintTabContent>`:
 *
 *   1. **Sin pendientes**: confirmación corta + botón "Cerrar sprint".
 *   2. **Con pendientes + hay planificado siguiente**: nombra el próximo
 *      sprint, cuenta los tickets a rollover, botón "Cerrar y mover N".
 *   3. **Con pendientes + NO hay planificado**: bloqueante. Botón "Crear
 *      próximo sprint" abre `<SprintFormDialog mode="create">` anidado;
 *      cuando se crea, este dialog **NO llama al server** — el `router.refresh()`
 *      del form dialog trae el nuevo planificado, y `<SprintTabContent>`
 *      re-renderea este dialog en estado 2 (donde el usuario confirma).
 *
 * El endpoint `POST /api/sprints/:id/close` hace todo el trabajo transaccional
 * — snapshot, rollover, cambio de status. Un solo click, un solo request.
 */
export function CloseSprintDialog({
  open,
  onOpenChange,
  activeSprint,
  pendingCount,
  nextPlannedSprint,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeSprint: SprintListItem;
  pendingCount: number;
  nextPlannedSprint: SprintListItem | null;
  projectId: string;
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [createNextOpen, setCreateNextOpen] = useState(false);

  const state: "no_pending" | "with_next" | "blocked" =
    pendingCount === 0
      ? "no_pending"
      : nextPlannedSprint !== null
        ? "with_next"
        : "blocked";

  async function performClose() {
    setError(null);
    setClosing(true);
    const stop = startSync("Cerrando sprint");
    try {
      const res = await fetch(`/api/sprints/${activeSprint.id}/close`, {
        method: "POST",
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
      };
      if (!res.ok) {
        setError(payload.reason ?? payload.error ?? "No se pudo cerrar el sprint.");
        return;
      }
      onOpenChange(false);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setClosing(false);
      stop();
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cerrar {formatSprintDisplayName(activeSprint).toLowerCase()}
            </DialogTitle>
            <DialogDescription>
              {state === "no_pending" &&
                "Todos los tickets del sprint están cerrados. Se genera el reporte y el sprint pasa a Old Sprints."}
              {state === "with_next" &&
                `Hay ${pendingCount} ticket${pendingCount === 1 ? "" : "s"} sin cerrar. Se van a mover automáticamente a ${formatSprintDisplayName(nextPlannedSprint!)}, y el sprint actual pasa a Old Sprints con su reporte.`}
              {state === "blocked" &&
                `Hay ${pendingCount} ticket${pendingCount === 1 ? "" : "s"} sin cerrar y no hay un próximo sprint donde moverlos. Creá el próximo sprint antes de cerrar este.`}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="text-ui text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {state === "blocked" ? (
              <Button onClick={() => setCreateNextOpen(true)}>Crear próximo sprint</Button>
            ) : (
              <Button
                variant="destructive"
                onClick={performClose}
                disabled={closing}
              >
                {state === "no_pending"
                  ? "Cerrar sprint"
                  : `Cerrar y mover ${pendingCount}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog anidado del create; al terminar, router.refresh() (del form
          dialog) trae el nuevo planificado y este componente re-renderea con
          state === "with_next". El PM ve el botón "Cerrar y mover N" y termina. */}
      <SprintFormDialog
        mode="create"
        open={createNextOpen}
        onOpenChange={setCreateNextOpen}
        projectId={projectId}
      />
    </>
  );
}
