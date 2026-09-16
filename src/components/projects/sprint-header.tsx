"use client";

import { useState } from "react";
import { CircleAlertIcon, PencilIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SprintListItem } from "@/lib/sprints/query";
import { formatSprintDisplayName } from "@/lib/sprints/status";
import type { TicketListItem } from "@/lib/tickets/query";
import { cn } from "@/lib/utils";

import { CloseSprintDialog } from "./close-sprint-dialog";
import { SprintFormDialog } from "./sprint-form-dialog";

/**
 * Header del sprint activo (018 T4.4): nombre, fechas, objetivo, progreso de
 * horas, warning de sin-estimar, y acciones (editar, cerrar).
 *
 * **Editar** está disponible para admin y PM del proyecto.
 * **Cerrar** solo para el PM primario — el server rechaza igual con 403 si
 * un admin lo intenta.
 *
 * La progress bar de horas: renderiza solo si hay al menos un ticket con
 * `estimated_hours`. Sin ninguno estimado, no hay progreso que mostrar; el
 * warning "N tickets sin estimar" toma su lugar.
 */
export function SprintHeader({
  sprint,
  tickets,
  nextPlannedSprint,
  projectId,
  canEdit,
  canClose,
}: {
  sprint: SprintListItem;
  tickets: TicketListItem[];
  nextPlannedSprint: SprintListItem | null;
  projectId: string;
  canEdit: boolean;
  canClose: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const metrics = computeSprintMetrics(tickets);

  return (
    <>
      <div className="border-border mb-4 flex flex-col gap-3 rounded-md border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-section font-medium">
                {formatSprintDisplayName(sprint)}
              </h2>
              <span className="text-caption text-muted-foreground font-data">
                {sprint.startsAt} → {sprint.endsAt}
              </span>
            </div>
            {sprint.goal && (
              <p className="text-ui text-muted-foreground mt-1 whitespace-pre-wrap">
                {sprint.goal}
              </p>
            )}
          </div>

          <div className="flex shrink-0 gap-2">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <PencilIcon aria-hidden="true" />
                Editar
              </Button>
            )}
            {canClose && (
              <Button size="sm" onClick={() => setCloseOpen(true)}>
                Cerrar sprint
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <ProgressLabel metrics={metrics} />
          {metrics.unestimatedCount > 0 && (
            <span className="text-caption text-attention inline-flex items-center gap-1.5">
              <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
              {metrics.unestimatedCount} ticket
              {metrics.unestimatedCount === 1 ? "" : "s"} sin estimar
            </span>
          )}
        </div>

        {metrics.totalEstimatedHours > 0 && (
          <ProgressBar
            completed={metrics.completedEstimatedHours}
            total={metrics.totalEstimatedHours}
          />
        )}
      </div>

      <SprintFormDialog
        mode="edit"
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={projectId}
        initial={{
          id: sprint.id,
          startsAt: sprint.startsAt,
          endsAt: sprint.endsAt,
          name: sprint.name ?? "",
          goal: sprint.goal ?? "",
        }}
      />

      <CloseSprintDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        activeSprint={sprint}
        pendingCount={metrics.pendingCount}
        nextPlannedSprint={nextPlannedSprint}
        projectId={projectId}
      />
    </>
  );
}

function ProgressLabel({ metrics }: { metrics: SprintMetrics }) {
  if (metrics.totalEstimatedHours === 0) {
    return (
      <span className="text-caption text-muted-foreground">
        {metrics.completedCount} de {metrics.totalCount} tickets cerrados
      </span>
    );
  }
  const pct = Math.round(
    (metrics.completedEstimatedHours / metrics.totalEstimatedHours) * 100,
  );
  return (
    <span className="text-caption text-muted-foreground">
      <span className="font-data text-foreground">
        {formatHours(metrics.completedEstimatedHours)}
      </span>{" "}
      de{" "}
      <span className="font-data text-foreground">
        {formatHours(metrics.totalEstimatedHours)}
      </span>{" "}
      hs · {pct}% · {metrics.completedCount} de {metrics.totalCount} tickets
    </span>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = Math.min(100, (completed / total) * 100);
  const complete = pct >= 100;
  return (
    <div
      className="bg-muted h-1 w-full overflow-hidden rounded-sm"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full transition-[width] duration-200",
          complete ? "bg-primary" : "bg-secondary-foreground",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

type SprintMetrics = {
  totalCount: number;
  completedCount: number;
  pendingCount: number;
  totalEstimatedHours: number;
  completedEstimatedHours: number;
  unestimatedCount: number;
};

function computeSprintMetrics(tickets: TicketListItem[]): SprintMetrics {
  let totalCount = 0;
  let completedCount = 0;
  let totalEstimatedHours = 0;
  let completedEstimatedHours = 0;
  let unestimatedCount = 0;

  for (const ticket of tickets) {
    totalCount++;
    const isDone = ticket.status === "done" || ticket.status === "cancelled";
    if (isDone) completedCount++;
    const hours = ticket.estimatedHours;
    if (hours === null) {
      unestimatedCount++;
    } else {
      totalEstimatedHours += hours;
      if (isDone) completedEstimatedHours += hours;
    }
  }

  return {
    totalCount,
    completedCount,
    pendingCount: totalCount - completedCount,
    totalEstimatedHours,
    completedEstimatedHours,
    unestimatedCount,
  };
}

function formatHours(value: number): string {
  // Sin decimales cuando son enteros; una cifra decimal si no. Evita mostrar
  // "16.00" cuando dice más "16" y evita "16.333" cuando queremos "16.3".
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}
