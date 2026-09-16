"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PencilIcon } from "lucide-react";

import { useSyncIndicator } from "@/components/sync-indicator";
import { Button } from "@/components/ui/button";
import type { SprintListItem } from "@/lib/sprints/query";
import { formatSprintDisplayName } from "@/lib/sprints/status";

import { SprintFormDialog } from "./sprint-form-dialog";

/**
 * Lista de sprints planificados (018 T4.4), al pie del tab Sprint. Cada uno
 * muestra nombre, fechas, count de tickets asignados, y dos acciones:
 * "Activar" (solo si no hay activo) y "Editar" (abre el mismo form dialog en
 * modo edit).
 */
export function PlannedSprintsList({
  sprints,
  hasActiveSprint,
  projectId,
  ticketCountBySprintId,
  canManage,
}: {
  sprints: SprintListItem[];
  hasActiveSprint: boolean;
  projectId: string;
  ticketCountBySprintId: Record<string, number>;
  canManage: boolean;
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SprintListItem | null>(null);

  async function activate(sprint: SprintListItem) {
    setError(null);
    const stop = startSync(`Activando ${formatSprintDisplayName(sprint).toLowerCase()}`);
    try {
      const res = await fetch(`/api/sprints/${sprint.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        setError(body.reason ?? body.error ?? "No se pudo activar el sprint.");
      } else {
        router.refresh();
      }
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      stop();
    }
  }

  if (sprints.length === 0) return null;

  return (
    <>
      <section className="mt-6">
        <h3 className="text-caption text-muted-foreground mb-2 font-medium">
          Próximos sprints
        </h3>
        {error && (
          <p role="alert" className="text-ui text-destructive mb-2">
            {error}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {sprints.map((sprint) => (
            <li
              key={sprint.id}
              className="border-border flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <p className="text-emphasis font-medium">
                    {formatSprintDisplayName(sprint)}
                  </p>
                  <span className="text-caption text-muted-foreground font-data">
                    {sprint.startsAt} → {sprint.endsAt}
                  </span>
                </div>
                <p className="text-caption text-muted-foreground">
                  {ticketCountBySprintId[sprint.id] ?? 0} ticket
                  {(ticketCountBySprintId[sprint.id] ?? 0) === 1 ? "" : "s"} asignado
                  {(ticketCountBySprintId[sprint.id] ?? 0) === 1 ? "" : "s"}
                </p>
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(sprint)}
                    aria-label="Editar"
                    title="Editar"
                  >
                    <PencilIcon aria-hidden="true" />
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => activate(sprint)}
                    disabled={hasActiveSprint}
                    title={
                      hasActiveSprint
                        ? "Ya hay un sprint activo en el proyecto"
                        : undefined
                    }
                  >
                    Activar
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <SprintFormDialog
        mode="edit"
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        projectId={projectId}
        initial={
          editing
            ? {
                id: editing.id,
                startsAt: editing.startsAt,
                endsAt: editing.endsAt,
                name: editing.name ?? "",
                goal: editing.goal ?? "",
              }
            : undefined
        }
      />
    </>
  );
}
