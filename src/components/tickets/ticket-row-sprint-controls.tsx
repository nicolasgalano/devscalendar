"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useSyncIndicator } from "@/components/sync-indicator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell } from "@/components/ui/table";
import type { SprintListItem } from "@/lib/sprints/query";
import { formatSprintDisplayName } from "@/lib/sprints/status";
import type { TicketListItem } from "@/lib/tickets/query";

const BACKLOG = "__backlog__";

/**
 * Dos celdas editables inline en el backlog scoped por proyecto (018 T5.1):
 * Sprint (Select) y Est. hs (input numérico).
 *
 * Ambos disparan `PATCH /api/tickets/:id` con optimistic. Reusan
 * `useSyncIndicator` para el pill flotante.
 *
 * **Solo se renderiza cuando `TicketList` sabe que el viewer es admin/PM/lead**.
 * El trigger `enforce_ticket_contributor_scope` (extendido en migration 16)
 * es la defensa dura — si un contributor llegara por URL, el server rechaza
 * con 403.
 */
export function TicketRowSprintControls({
  ticket,
  openSprints,
}: {
  ticket: TicketListItem;
  openSprints: SprintListItem[];
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [sprintId, setSprintId] = useState<string | null>(ticket.sprintId);
  const [hoursText, setHoursText] = useState<string>(
    ticket.estimatedHours === null ? "" : String(ticket.estimatedHours),
  );
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, label: string) {
    setError(null);
    const stop = startSync(label);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        setError(payload.reason ?? payload.error ?? "No se pudo actualizar.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("No se pudo conectar con el servidor.");
      return false;
    } finally {
      stop();
    }
  }

  async function onSprintChange(nextRaw: string | null) {
    const next = nextRaw === BACKLOG || nextRaw === null ? null : nextRaw;
    setSprintId(next); // optimista
    const ok = await patch({ sprint_id: next }, "Moviendo ticket");
    if (!ok) setSprintId(ticket.sprintId); // rollback
  }

  async function onHoursBlur() {
    const trimmed = hoursText.trim();
    const nextValue = trimmed === "" ? null : Number(trimmed);
    if (nextValue !== null && (!Number.isFinite(nextValue) || nextValue < 0)) {
      setError("Ingresá un número válido (o vacío para quitar).");
      setHoursText(ticket.estimatedHours === null ? "" : String(ticket.estimatedHours));
      return;
    }
    if (nextValue === ticket.estimatedHours) return;
    const ok = await patch({ estimated_hours: nextValue }, "Guardando estimación");
    if (!ok) {
      setHoursText(ticket.estimatedHours === null ? "" : String(ticket.estimatedHours));
    }
  }

  return (
    <>
      <TableCell>
        <Select
          value={sprintId ?? BACKLOG}
          onValueChange={(next) => onSprintChange(next)}
        >
          <SelectTrigger size="sm" className="w-full" aria-label="Sprint">
            <SelectValue>
              {sprintId
                ? (() => {
                    const sprint = openSprints.find((s) => s.id === sprintId);
                    // Puede pasar que el sprint actual esté completado y no
                    // esté en openSprints — mostramos el nombre viejo del ticket.
                    return sprint
                      ? formatSprintDisplayName(sprint)
                      : ticket.sprintNumero
                        ? formatSprintDisplayName({
                            numero: ticket.sprintNumero,
                            name: ticket.sprintName,
                          })
                        : "—";
                  })()
                : "Backlog"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            <SelectItem value={BACKLOG}>Backlog</SelectItem>
            {openSprints.map((sprint) => (
              <SelectItem key={sprint.id} value={sprint.id}>
                {formatSprintDisplayName(sprint)}
                {sprint.status === "active" && (
                  <span className="text-caption text-muted-foreground ml-1">
                    (activo)
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && (
          <p role="alert" className="text-caption text-destructive mt-1">
            {error}
          </p>
        )}
      </TableCell>
      <TableCell className="font-data text-right">
        <input
          type="number"
          min="0"
          step="0.25"
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-7 w-16 rounded-md border bg-transparent px-1.5 text-right outline-none focus-visible:ring-3"
          value={hoursText}
          onChange={(e) => setHoursText(e.target.value)}
          onBlur={onHoursBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </TableCell>
    </>
  );
}
